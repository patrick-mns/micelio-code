use crate::backend::hierarchy::{build_treemap, Area};
use crate::backend::knowledge::NodeKind;
use crate::AppState;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

/// One node queued for (re)summarization: (node id, file path, optional span).
type SummarizeItem = (usize, String, Option<(usize, usize)>);

#[derive(Serialize)]
pub struct TreemapNode {
    pub id: usize,
    pub name: String,
    pub kind: String,
    pub value: usize,
    pub tokens: usize,
    pub active: bool,
    pub summary: String,
    pub path: Option<String>,
    pub children: Vec<TreemapNode>,
}

fn kind_str(kind: NodeKind) -> String {
    match kind {
        NodeKind::File => "File",
        NodeKind::Function => "Function",
        NodeKind::Class => "Class",
        NodeKind::Concept => "Concept",
        NodeKind::Directory => "Directory",
        NodeKind::Note => "Note",
    }
    .to_string()
}

#[tauri::command]
pub async fn get_graph(state: State<'_, AppState>) -> Result<Vec<TreemapNode>, String> {
    let graph = state.graph.lock().unwrap();

    fn convert(
        nodes: &[crate::backend::hierarchy::TreemapNode],
        graph: &crate::backend::knowledge::KnowledgeGraph,
    ) -> Vec<TreemapNode> {
        nodes
            .iter()
            .map(|n| {
                let gnode = graph.nodes().iter().find(|g| g.id == n.id);
                TreemapNode {
                    id: n.id,
                    name: n.label.rsplit('/').next().unwrap_or(&n.label).to_string(),
                    kind: kind_str(n.kind),
                    value: n.weight,
                    tokens: gnode.map(|g| g.tokens).unwrap_or(0),
                    active: n.active,
                    summary: gnode.map(|g| g.summary.clone()).unwrap_or_default(),
                    path: gnode.and_then(|g| g.attachment.as_ref().map(|a| a.path.clone())),
                    children: convert(&n.children, graph),
                }
            })
            .collect()
    }

    let area = Area {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    };
    let roots = build_treemap(&graph, area);
    Ok(convert(&roots, &graph))
}

#[tauri::command]
pub async fn scan_workspace(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    // Reset cancel flag at the start of every scan
    state
        .scan_cancel
        .store(false, std::sync::atomic::Ordering::SeqCst);

    let Some(ws) = state.current_workspace.lock().unwrap().clone() else {
        return Ok(0); // No workspace to scan.
    };
    let multi_folder = ws.folders.len() > 1;

    let mut total_added = 0;
    let mut graph = crate::backend::knowledge::KnowledgeGraph::new();

    for folder in &ws.folders {
        if state.scan_cancel.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let prefix = if multi_folder {
            folder.file_name().map(|n| n.to_string_lossy().to_string())
        } else {
            None
        };
        let added =
            graph.scan_workspace_progress(folder, prefix, &state.scan_cancel, &mut |_| {})?;
        total_added += added.added;
    }

    // Persist to workspace dir
    let path = ws.dir().join("graph.json");
    let _ = graph.save(&path);

    // Save back to AppState
    *state.graph.lock().unwrap() = graph;

    app.emit("graph_updated", total_added)
        .map_err(|e| e.to_string())?;

    Ok(total_added)
}

/// Signal the workspace scan to stop.
#[tauri::command]
pub async fn cancel_workspace_scan(state: State<'_, AppState>) -> Result<(), String> {
    state
        .scan_cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// Code backing a node: the function/class span, or the whole file. Returned
/// to the detail modal for an in-app preview.
#[derive(Serialize)]
pub struct NodeCode {
    pub code: String,
    /// Prism language id for syntax highlighting (e.g. "rust", "javascript").
    pub language: String,
    /// 1-based line number the snippet starts at (for the gutter).
    pub start_line: usize,
    pub path: Option<String>,
    pub truncated: bool,
    /// True if the node has a summary but the file content changed (hash mismatch).
    #[serde(default)]
    pub summary_stale: bool,
}

/// Resolve a (usually workspace-relative) attachment path to an absolute path.
/// The app's process cwd is not the workspace root, so relative paths must be
/// joined onto it; absolute paths pass through unchanged.
fn resolve_in_workspace(state: &State<'_, AppState>, path: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(path);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    state.workspace_root.lock().unwrap().join(p)
}

/// Map a file extension to a Prism language id. Falls back to plain text.
fn lang_from_path(path: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let lang = match ext.as_str() {
        "rs" => "rust",
        "py" => "python",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "ts" => "typescript",
        "tsx" => "tsx",
        "go" => "go",
        "json" => "json",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "md" | "markdown" => "markdown",
        "html" | "htm" => "markup",
        "css" => "css",
        "sh" | "bash" | "zsh" => "bash",
        "c" | "h" => "c",
        "cpp" | "cc" | "hpp" => "cpp",
        "java" => "java",
        "rb" => "ruby",
        _ => "text",
    };
    lang.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_str_all_variants() {
        assert_eq!(kind_str(NodeKind::File), "File");
        assert_eq!(kind_str(NodeKind::Function), "Function");
        assert_eq!(kind_str(NodeKind::Class), "Class");
        assert_eq!(kind_str(NodeKind::Concept), "Concept");
        assert_eq!(kind_str(NodeKind::Directory), "Directory");
        assert_eq!(kind_str(NodeKind::Note), "Note");
    }

    #[test]
    fn lang_from_path_known_extensions() {
        assert_eq!(lang_from_path("main.rs"), "rust");
        assert_eq!(lang_from_path("app.tsx"), "tsx");
        assert_eq!(lang_from_path("style.css"), "css");
        assert_eq!(lang_from_path("build.sh"), "bash");
        assert_eq!(lang_from_path("Cargo.toml"), "toml");
    }

    #[test]
    fn lang_from_path_unknown_extension() {
        assert_eq!(lang_from_path("data.db"), "text");
        assert_eq!(lang_from_path("Makefile"), "text");
    }

    #[test]
    fn lang_from_path_no_extension() {
        assert_eq!(lang_from_path("README"), "text");
    }

    #[test]
    fn lang_from_path_case_insensitive() {
        assert_eq!(lang_from_path("App.TS"), "typescript");
        assert_eq!(lang_from_path("Dockerfile.RS"), "rust");
    }
}

/// Read the code a node maps to. Functions/classes return just their span;
/// file nodes return the whole file (capped). Concept/note nodes with no file
/// attachment return an error the UI can fall back from.
#[tauri::command]
pub async fn get_node_code(state: State<'_, AppState>, node_id: usize) -> Result<NodeCode, String> {
    const MAX_BYTES: usize = 200_000;

    let (attachment, stored_hash, has_summary) = {
        let graph = state.graph.lock().unwrap();
        let node = graph
            .nodes()
            .iter()
            .find(|n| n.id == node_id)
            .ok_or("node not found")?;
        let att = node
            .attachment
            .clone()
            .ok_or("this node has no file attached")?;
        (att, node.content_hash, !node.summary.is_empty())
    };

    // Attachment paths are stored relative to the workspace; the process cwd is
    // not the workspace, so resolve against workspace_root before reading.
    let full_path = resolve_in_workspace(&state, &attachment.path);
    let full = std::fs::read_to_string(&full_path)
        .map_err(|e| format!("could not read {}: {e}", full_path.display()))?;

    let (mut code, start_line) = match attachment.span {
        Some((start, _)) => (
            crate::backend::knowledge::extract_span(&full, attachment.span),
            start,
        ),
        None => (full, 1),
    };

    // Check if summary is stale: has a summary but content hash differs.
    let current_hash = crate::backend::knowledge::content_hash(&code);
    let summary_stale = has_summary && stored_hash.is_some() && stored_hash != Some(current_hash);

    let truncated = code.len() > MAX_BYTES;
    if truncated {
        // Cut on a char boundary so we never split a UTF-8 sequence.
        let mut end = MAX_BYTES;
        while end > 0 && !code.is_char_boundary(end) {
            end -= 1;
        }
        code.truncate(end);
        code.push_str("\n… (truncated)");
    }

    Ok(NodeCode {
        code,
        language: lang_from_path(&attachment.path),
        start_line,
        path: Some(attachment.path),
        truncated,
        summary_stale,
    })
}

#[tauri::command]
pub async fn summarize_node(
    app: AppHandle,
    state: State<'_, AppState>,
    node_id: usize,
) -> Result<String, String> {
    let (model, vision_model, node_info) = {
        let model = state.summarize_model();
        let vision_model = state.vision_model();
        let graph = state.graph.lock().unwrap();
        let node = graph
            .nodes()
            .iter()
            .find(|n| n.id == node_id)
            .ok_or("node not found")?;
        let attachment = node.attachment.clone();
        (model, vision_model, attachment)
    };

    let attachment = node_info;
    let att_path = attachment.as_ref().map(|a| a.path.clone());

    // Image nodes go through the Vision model (describe), not the text
    // summarizer — reading their bytes as UTF-8 would just yield garbage.
    let summary = if att_path
        .as_deref()
        .map(crate::backend::tools::file::is_image_path)
        .unwrap_or(false)
    {
        let path = att_path.unwrap();
        if vision_model.trim().is_empty() {
            return Err("no Vision model assigned — pick one in the model selector".to_string());
        }
        let full_path = resolve_in_workspace(&state, &path);
        let bytes =
            std::fs::read(&full_path).map_err(|e| format!("failed to read image {path}: {e}"))?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let mime = crate::backend::tools::file::image_mime(&path);
        let provider = crate::backend::llm::provider_for_model(&vision_model);
        provider.describe_image(
            &vision_model,
            &b64,
            mime,
            "Describe this image in 1-2 sentences for a code/project knowledge map.",
            false,
        )?
    } else {
        let content = if let Some(att) = &attachment {
            let full_path = resolve_in_workspace(&state, &att.path);
            std::fs::read_to_string(&full_path)
                .map(|s| crate::backend::knowledge::extract_span(&s, att.span))
                .unwrap_or_default()
        } else {
            String::new()
        };
        if content.is_empty() {
            return Err("no content to summarize".to_string());
        }
        let provider = crate::backend::llm::provider_for_model(&model);
        let prompt = format!(
            "Summarize this code in 1-2 sentences:\n\n```\n{}\n```",
            content
        );
        provider.chat_simple(&model, "You are a code summarizer.", &prompt, false)?
    };

    {
        let mut graph = state.graph.lock().unwrap();
        graph.set_summary(node_id, &summary, None);
        let root = state.workspace_root.lock().unwrap().clone();
        let path = root.join(".micelio/graph.json");
        let _ = graph.save(&path);
    }

    app.emit("node_summarized", (node_id, summary.clone()))
        .map_err(|e| e.to_string())?;

    Ok(summary)
}

#[derive(Serialize, Clone)]
struct SummarizeProgress {
    done: usize,
    total: usize,
    /// How many nodes failed (LLM error / rate limit) — surfaced so a partial
    /// run doesn't look fully successful.
    failed: usize,
}

/// Default number of nodes summarized in parallel when the caller doesn't
/// specify. Each worker is one blocking LLM call, so this is plain thread
/// concurrency; it's clamped to a sane range below.
const DEFAULT_SUMMARIZE_CONCURRENCY: usize = 4;
const MAX_SUMMARIZE_CONCURRENCY: usize = 12;

/// Bulk-summarize every node that has no summary or whose summary is stale
/// (content hash changed). Runs in the background with `concurrency` worker
/// threads pulling from a shared queue, so summaries land as they finish.
/// Emits `summarize_progress` per node, `node_summarized` + `graph_updated` as
/// each lands, and `summarize_done` at the end. Cancelable via `stop_summarize`.
/// `concurrency` is optional — `None` uses [`DEFAULT_SUMMARIZE_CONCURRENCY`].
#[tauri::command]
pub async fn summarize_all(app: AppHandle, concurrency: Option<usize>) -> Result<(), String> {
    use crate::backend::knowledge::{content_hash, extract_span};
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    let (model, workspace_root) = {
        let state = app.state::<AppState>();
        let m = state.summarize_model();
        let ws = state.workspace_root.lock().unwrap().clone();
        (m, ws)
    };

    let cancel = {
        let state = app.state::<AppState>();
        state.summarize_cancel.store(false, Ordering::SeqCst);
        state.summarize_cancel.clone()
    };

    let resolve = {
        let ws = workspace_root.clone();
        move |path: &str| -> std::path::PathBuf {
            let p = std::path::Path::new(path);
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                ws.join(p)
            }
        }
    };

    // Build the worklist: nodes with an attachment that are unsummarized or
    // stale. Unsummarized needs no read; stale requires reading to compare.
    let worklist: Vec<SummarizeItem> = {
        let state = app.state::<AppState>();
        let graph = state.graph.lock().unwrap();
        graph
            .nodes()
            .iter()
            .filter_map(|n| {
                let att = n.attachment.as_ref()?;
                if n.summary.is_empty() {
                    return Some((n.id, att.path.clone(), att.span));
                }
                let content = std::fs::read_to_string(resolve(&att.path))
                    .ok()
                    .map(|s| extract_span(&s, att.span))?;
                (n.content_hash != Some(content_hash(&content)))
                    .then(|| (n.id, att.path.clone(), att.span))
            })
            .collect()
    };

    let total = worklist.len();
    if total == 0 {
        let _ = app.emit(
            "summarize_done",
            SummarizeProgress {
                done: 0,
                total: 0,
                failed: 0,
            },
        );
        return Ok(());
    }

    // Resolve concurrency: default if unset, clamped, and never more workers
    // than there is work.
    let workers = concurrency
        .unwrap_or(DEFAULT_SUMMARIZE_CONCURRENCY)
        .clamp(1, MAX_SUMMARIZE_CONCURRENCY)
        .min(total);

    // Persist the graph to disk only every Nth completion (plus a final save),
    // instead of after every node — with many workers, writing the whole
    // graph.json each time serializes them on the lock and thrashes disk.
    const SAVE_EVERY: usize = 10;

    let worklist = Arc::new(worklist);
    let next = Arc::new(AtomicUsize::new(0)); // shared cursor into the worklist
    let done = Arc::new(AtomicUsize::new(0)); // completed count (for progress)
    let failed = Arc::new(AtomicUsize::new(0)); // LLM errors / rate limits

    // Manager thread: spawn the worker pool, wait for it, then emit done.
    std::thread::spawn(move || {
        let _ = app.emit(
            "summarize_progress",
            SummarizeProgress {
                done: 0,
                total,
                failed: 0,
            },
        );

        let mut handles = Vec::with_capacity(workers);
        for _ in 0..workers {
            let app = app.clone();
            let cancel = cancel.clone();
            let worklist = worklist.clone();
            let next = next.clone();
            let done = done.clone();
            let failed = failed.clone();
            let model = model.clone();
            let ws = workspace_root.clone();
            handles.push(std::thread::spawn(move || {
                let provider = crate::backend::llm::provider_for_model(&model);
                loop {
                    if cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    // Claim the next node; stop when the queue is drained.
                    let idx = next.fetch_add(1, Ordering::SeqCst);
                    if idx >= worklist.len() {
                        break;
                    }
                    let (node_id, path, span) = worklist[idx].clone();

                    let full = {
                        let p = std::path::Path::new(&path);
                        if p.is_absolute() {
                            p.to_path_buf()
                        } else {
                            ws.join(p)
                        }
                    };
                    let content = std::fs::read_to_string(&full)
                        .ok()
                        .map(|s| extract_span(&s, span))
                        .unwrap_or_default()
                        .chars()
                        .take(8000)
                        .collect::<String>();

                    if !content.trim().is_empty() {
                        let hash = content_hash(&content);
                        let prompt =
                            format!("Summarize this code in 1-2 sentences:\n\n```\n{content}\n```");
                        match provider.chat_simple(
                            &model,
                            "You are a code summarizer.",
                            &prompt,
                            false,
                        ) {
                            Ok(summary) => {
                                {
                                    let state = app.state::<AppState>();
                                    let mut graph = state.graph.lock().unwrap();
                                    graph.set_summary(node_id, summary.trim(), Some(hash));
                                }
                                let _ = app
                                    .emit("node_summarized", (node_id, summary.trim().to_string()));
                                let _ = app.emit("graph_updated", ());
                            }
                            Err(_) => {
                                // LLM error (often a rate limit) — count it so the
                                // run doesn't look fully successful.
                                failed.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                    }

                    // `done` counts completions (drives progress + the manager's
                    // termination check). Persist only every Nth completion.
                    let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                    if d.is_multiple_of(SAVE_EVERY) {
                        let state = app.state::<AppState>();
                        let graph = state.graph.lock().unwrap();
                        let root = state.workspace_root.lock().unwrap().clone();
                        let _ = graph.save(&root.join(".micelio/graph.json"));
                    }

                    // Suppress progress once canceled so a straggler finishing
                    // its in-flight call can't re-open the (already cleared) UI.
                    if !cancel.load(Ordering::SeqCst) {
                        let _ = app.emit(
                            "summarize_progress",
                            SummarizeProgress {
                                done: d,
                                total,
                                failed: failed.load(Ordering::SeqCst),
                            },
                        );
                    }
                }
            }));
        }

        // Emit `done` the moment the user cancels (or all work finishes) — don't
        // make them wait for in-flight LLM calls to return. The workers stop
        // claiming new nodes immediately; any in-flight call finishes in the
        // background (its summary is still saved) and the thread then exits.
        loop {
            if cancel.load(Ordering::SeqCst) || done.load(Ordering::SeqCst) >= total {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(80));
        }

        // Tell the UI we're done immediately (so cancel feels instant); the
        // in-memory graph already has every summary, so the view is correct.
        let _ = app.emit(
            "summarize_done",
            SummarizeProgress {
                done: done.load(Ordering::SeqCst),
                total,
                failed: failed.load(Ordering::SeqCst),
            },
        );

        // Wind the threads down, then do one final disk save to capture
        // everything written since the last throttled save (incl. stragglers).
        for h in handles {
            let _ = h.join();
        }
        {
            let state = app.state::<AppState>();
            let graph = state.graph.lock().unwrap();
            let root = state.workspace_root.lock().unwrap().clone();
            let _ = graph.save(&root.join(".micelio/graph.json"));
        }
    });

    Ok(())
}

/// Signal the bulk `/summarize` worker to stop after the current node.
#[tauri::command]
pub async fn stop_summarize(state: State<'_, AppState>) -> Result<(), String> {
    state.summarize_cancel.store(true, Ordering::SeqCst);
    Ok(())
}
