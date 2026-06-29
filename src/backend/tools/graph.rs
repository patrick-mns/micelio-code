use super::{ToolContext, ToolResult};

/// Read view of the knowledge graph. Dispatch order:
///   - `symbol` set → references to that symbol
///   - `filter` set → flat list of nodes matching the filter
///   - neither     → full overview tree
///
/// (Consolidates the old graph_overview / graph_query / graph_refs.)
pub fn run_view(arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    if let Some(symbol) = super::get_string_field(arguments, "symbol") {
        if !symbol.is_empty() {
            return run_refs(&symbol, context);
        }
    }
    if let Some(filter) = super::get_string_field(arguments, "filter") {
        if !filter.is_empty() {
            return run_filtered(&filter, context);
        }
    }
    run_overview(context)
}

/// Flat list of nodes matching a filter. Supported filters:
///   - `summarized`   — only nodes that have a summary
///   - `unsummarized` — only nodes that lack a summary (and have content)
///   - `active` / `inactive` — by context state
///   - a kind: `file`, `function`/`func`, `class`, `concept`, `dir`/`directory`, `note`
fn run_filtered(filter: &str, context: &ToolContext) -> Result<ToolResult, String> {
    use crate::backend::knowledge::{KnowledgeGraph, NodeKind};

    let graph: KnowledgeGraph =
        serde_json::from_str(&context.graph_json).map_err(|e| format!("graph parse: {e}"))?;

    let f = filter.trim().to_lowercase();
    let kind_match = |k: NodeKind| -> bool {
        match f.as_str() {
            "file" => k == NodeKind::File,
            "function" | "func" => k == NodeKind::Function,
            "class" => k == NodeKind::Class,
            "concept" => k == NodeKind::Concept,
            "dir" | "directory" => k == NodeKind::Directory,
            "note" => k == NodeKind::Note,
            _ => false,
        }
    };

    let matches: Vec<&crate::backend::knowledge::GraphNode> = graph
        .nodes()
        .iter()
        .filter(|n| match f.as_str() {
            "summarized" => !n.summary.is_empty(),
            "unsummarized" => n.summary.is_empty() && n.attachment.is_some(),
            "active" => n.active,
            "inactive" => !n.active,
            _ => kind_match(n.kind),
        })
        .collect();

    if matches.is_empty() {
        return Ok(ToolResult {
            content: format!(
                "no nodes match filter `{filter}`. Supported filters: summarized, \
                 unsummarized, active, inactive, or a kind (file, function, class, \
                 concept, dir, note)."
            ),
        });
    }

    let mut out = format!("{} node(s) matching filter `{filter}`:\n", matches.len());
    for n in matches {
        let mark = if n.active { "[x]" } else { "[ ]" };
        let tokens = if n.size > 0 {
            format!(" ~{}tok", (n.size / 4).max(1))
        } else {
            String::new()
        };
        let summary = if n.summary.is_empty() {
            String::new()
        } else {
            format!(" — {}", n.summary)
        };
        out.push_str(&format!(
            "{} {} {} ({}){}{}\n",
            mark, n.kind, n.name, n.label, tokens, summary
        ));
    }
    Ok(ToolResult { content: out })
}

/// Find where a symbol is used, based on References edges.
fn run_refs(symbol: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let graph: crate::backend::knowledge::KnowledgeGraph =
        serde_json::from_str(&context.graph_json).map_err(|e| format!("graph parse: {e}"))?;

    let targets: Vec<usize> = graph
        .nodes()
        .iter()
        .filter(|n| n.name == symbol || n.label == symbol)
        .map(|n| n.id)
        .collect();
    if targets.is_empty() {
        return Ok(ToolResult {
            content: format!("symbol `{symbol}` not found in the graph"),
        });
    }

    let mut lines = Vec::new();
    for edge in graph.edges() {
        if edge.kind != crate::backend::knowledge::EdgeKind::References {
            continue;
        }
        if targets.contains(&edge.to) {
            if let Some(user) = graph.nodes().iter().find(|n| n.id == edge.from) {
                lines.push(format!("- used in {}", user.label));
            }
        }
    }
    let content = if lines.is_empty() {
        format!("`{symbol}` has no recorded references (run /graph refresh first)")
    } else {
        format!("`{symbol}` is referenced in:\n{}", lines.join("\n"))
    };
    Ok(ToolResult { content })
}

/// Compact, human/model-readable tree of the whole graph: hierarchy,
/// active state, kind, summary and approximate token weight per node.
fn run_overview(context: &ToolContext) -> Result<ToolResult, String> {
    use crate::backend::knowledge::{EdgeKind, KnowledgeGraph};
    use std::collections::{HashMap, HashSet};

    let graph: KnowledgeGraph =
        serde_json::from_str(&context.graph_json).map_err(|e| format!("graph parse: {e}"))?;

    let mut children: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut has_parent: HashSet<usize> = HashSet::new();
    for e in graph.edges() {
        if e.kind == EdgeKind::Contains {
            children.entry(e.from).or_default().push(e.to);
            has_parent.insert(e.to);
        }
    }

    fn write_node(
        graph: &crate::backend::knowledge::KnowledgeGraph,
        children: &std::collections::HashMap<usize, Vec<usize>>,
        id: usize,
        depth: usize,
        out: &mut String,
    ) {
        let Some(n) = graph.nodes().iter().find(|n| n.id == id) else {
            return;
        };
        let mark = if n.active { "[x]" } else { "[ ]" };
        let tokens = if n.size > 0 {
            format!(" ~{}tok", (n.size / 4).max(1))
        } else {
            String::new()
        };
        let summary = if n.summary.is_empty() {
            String::new()
        } else {
            format!(" — {}", n.summary)
        };
        out.push_str(&format!(
            "{}{} {} {} ({}){}{}\n",
            "  ".repeat(depth),
            mark,
            n.kind,
            n.name,
            n.label,
            tokens,
            summary
        ));
        if let Some(kids) = children.get(&id) {
            let mut kids = kids.clone();
            kids.sort();
            for kid in kids {
                write_node(graph, children, kid, depth + 1, out);
            }
        }
    }

    let mut out = String::from(
        "Knowledge graph overview ([x] = active in context, [ ] = deactivated).\n\
         Use graph_focus {selector, active} to focus context on what matters for the task.\n\n",
    );
    let mut roots: Vec<usize> = graph
        .nodes()
        .iter()
        .filter(|n| !has_parent.contains(&n.id))
        .map(|n| n.id)
        .collect();
    roots.sort();
    for root in roots {
        write_node(&graph, &children, root, 0, &mut out);
    }
    Ok(ToolResult { content: out })
}

/// Validation half of graph_focus; the actual mutation is applied by
/// the UI when the tool call is registered.
pub fn run_focus(arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let selector = super::get_string_field(arguments, "selector")
        .ok_or_else(|| "missing `selector` argument".to_string())?;
    let active = super::get_string_field(arguments, "active")
        .map(|v| v == "true" || v == "yes" || v == "on")
        .unwrap_or(true);

    let graph: crate::backend::knowledge::KnowledgeGraph =
        serde_json::from_str(&context.graph_json).map_err(|e| format!("graph parse: {e}"))?;
    let count = graph
        .nodes()
        .iter()
        .filter(|n| {
            n.label == selector
                || n.name == selector
                || n.label.starts_with(&format!("{selector}/"))
                || n.label.starts_with(&format!("{selector}::"))
        })
        .count();
    if count == 0 {
        return Ok(ToolResult {
            content: format!("no nodes match `{selector}`"),
        });
    }
    Ok(ToolResult {
        content: format!(
            "{} {} node(s) matching `{selector}`",
            if active { "activated" } else { "deactivated" },
            count
        ),
    })
}
