#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::path::Path;

use crate::backend::error::{BackendError, BackendResult};
use crate::backend::tokens::count_tokens;

/// FNV-1a (64-bit) hash of `s`. Non-cryptographic — used only for content
/// change detection — and hand-rolled so the value is stable forever
/// (unlike `DefaultHasher`, whose output the std lib may change between
/// Rust releases, which would break persisted hashes).
pub fn content_hash(s: &str) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut h = OFFSET;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(PRIME);
    }
    h
}

/// Extracts the content a node maps to: the full file when `span` is None,
/// otherwise the inclusive 1-based line range. Centralized so summarize and
/// the staleness check hash exactly the same bytes.
pub fn extract_span(full: &str, span: Option<(usize, usize)>) -> String {
    match span {
        Some((start, end)) => full
            .lines()
            .skip(start.saturating_sub(1))
            .take(end.saturating_sub(start) + 1)
            .collect::<Vec<_>>()
            .join("\n"),
        None => full.to_string(),
    }
}

/// Heuristic for minified / generated files (e.g. `*.min.css`, bundled JS):
/// everything sits on one or a few enormous lines. Symbol spans in such files
/// each cover the whole file, so per-symbol token counting degrades to
/// O(symbols × filesize) and can freeze the scan. We index the file node but
/// skip granular symbol extraction for them.
pub fn is_minified(source: &str) -> bool {
    const MAX_LINE_LEN: usize = 5_000;
    source.lines().any(|l| l.len() > MAX_LINE_LEN)
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
pub enum NodeKind {
    File,
    Function,
    Class,
    Concept,
    Directory,
    Note,
}

impl fmt::Display for NodeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NodeKind::File => write!(f, "file"),
            NodeKind::Function => write!(f, "func"),
            NodeKind::Class => write!(f, "class"),
            NodeKind::Concept => write!(f, "concept"),
            NodeKind::Directory => write!(f, "dir"),
            NodeKind::Note => write!(f, "note"),
        }
    }
}

/// Link from a node to the real content that backs it.
#[derive(Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub path: String,
    /// Line range (start, end) when the node maps to part of a file
    /// (e.g. a function). None = the whole file.
    #[serde(default)]
    pub span: Option<(usize, usize)>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: usize,
    /// Unique hierarchical key (e.g. "src/ui.rs::draw_chat_panel").
    pub label: String,
    /// Short display name (basename / symbol name).
    #[serde(default)]
    pub name: String,
    /// One-line summary (AI- or user-provided).
    #[serde(default)]
    pub summary: String,
    pub kind: NodeKind,
    pub active: bool,
    pub highlight: bool,
    /// Content size in bytes, derived from the attachment.
    #[serde(default)]
    pub size: usize,
    #[serde(default)]
    pub attachment: Option<Attachment>,
    /// FNV-1a hash of the (span-aware) content that produced the current
    /// `summary`. Drives incremental re-summarization: when the file
    /// changes, the recomputed hash differs and the node is re-processed.
    /// None = never summarized, or a graph saved before hashing existed.
    #[serde(default)]
    pub content_hash: Option<u64>,
    /// Token count (tiktoken cl100k_base) — computed during scan when
    /// content is available; 0 means un-scanned (fall back to estimate).
    #[serde(default)]
    pub tokens: usize,
    /// Baked layout position (graph units), persisted with the graph so a
    /// front-end can render a settled layout without recomputing physics.
    #[serde(default)]
    pub pos: Option<(f32, f32)>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub enum EdgeKind {
    /// Structural: dir → file → symbol. Drives the treemap.
    Contains,
    /// Usage: symbol → symbol it references.
    References,
    /// Free association created via chat/AI.
    Related,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: usize,
    pub to: usize,
    #[serde(default = "default_edge_kind")]
    pub kind: EdgeKind,
}

fn default_edge_kind() -> EdgeKind {
    EdgeKind::Contains
}

/// One symbol gathered for the references pass: (node id, symbol name,
/// owning file label, optional line span).
type SymbolEntry = (usize, String, String, Option<(usize, usize)>);

/// Outcome of a workspace scan.
pub struct ScanReport {
    pub added: usize,
    /// True when the scan hit the node ceiling and stopped early.
    pub truncated: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct KnowledgeGraph {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
    next_id: usize,

    /// Cached JSON serialization (compact, for the LLM context window).
    /// Invalidated on every mutation and recomputed lazily by [`serialize`].
    /// Interior mutability via RefCell — the graph is already behind a Mutex,
    /// so this never races.
    #[serde(skip)]
    json_cache: RefCell<Option<String>>,
}

impl Default for KnowledgeGraph {
    fn default() -> Self {
        Self::new()
    }
}

impl KnowledgeGraph {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            edges: Vec::new(),
            next_id: 1,
            json_cache: RefCell::new(None),
        }
    }

    /// Returns a compact JSON representation of the graph, using a cached
    /// value when the graph hasn't changed since the last call.
    pub fn serialize(&self) -> String {
        let mut cache = self.json_cache.borrow_mut();
        if let Some(ref cached) = *cache {
            return cached.clone();
        }
        let json = serde_json::to_string(self).unwrap_or_else(|_| "{}".into());
        *cache = Some(json.clone());
        json
    }

    /// Stands in for a locked node's summary. The model is told the file exists
    /// and why it can't read it, so it stops guessing at the contents or
    /// recreating a file it thinks is missing.
    const LOCKED_SUMMARY: &'static str =
        "[locked by the user — this file exists but its contents are not readable]";

    /// Whether a node's content belongs to a locked path. Symbol nodes
    /// (functions, classes) attach to the file they live in, so locking the file
    /// covers them too; File/Directory nodes carry the path in their label.
    fn node_is_locked(node: &GraphNode, locks: &crate::backend::locks::LockedFilter) -> bool {
        if let Some(a) = &node.attachment {
            if locks.is_locked(&a.path) {
                return true;
            }
        }
        locks.is_locked(&node.label)
    }

    /// Serialize for the model's context. A locked file stays on the map — the
    /// model should know it exists, so it doesn't recreate it or guess around
    /// it — but nothing derived from its contents survives: the summary is
    /// replaced by a marker, and the symbols parsed out of the file are dropped
    /// (a function name like `decrypt_master_key` is content).
    pub fn serialize_for_model(&self, locks: &crate::backend::locks::LockedFilter) -> String {
        if locks.is_empty() {
            return self.serialize(); // nothing locked — reuse the cache
        }
        let locked: HashSet<usize> = self
            .nodes
            .iter()
            .filter(|n| Self::node_is_locked(n, locks))
            .map(|n| n.id)
            .collect();
        if locked.is_empty() {
            return self.serialize();
        }

        // A symbol carries a span; the file or directory node it was parsed out
        // of does not. Only the symbols are dropped — their names are content.
        let hidden: HashSet<usize> = self
            .nodes
            .iter()
            .filter(|n| locked.contains(&n.id))
            .filter(|n| n.attachment.as_ref().is_some_and(|a| a.span.is_some()))
            .map(|n| n.id)
            .collect();

        let visible = KnowledgeGraph {
            nodes: self
                .nodes
                .iter()
                .filter(|n| !hidden.contains(&n.id))
                .map(|n| {
                    if !locked.contains(&n.id) {
                        return n.clone();
                    }
                    let mut redacted = n.clone();
                    redacted.summary = Self::LOCKED_SUMMARY.to_string();
                    // The hash is over content the model can't see; leaving it
                    // would only invite a staleness comparison it can't make.
                    redacted.content_hash = None;
                    redacted
                })
                .collect(),
            // Edges into dropped symbols would dangle; edges to the locked file
            // itself stay, since that node is still there.
            edges: self
                .edges
                .iter()
                .filter(|e| !hidden.contains(&e.from) && !hidden.contains(&e.to))
                .cloned()
                .collect(),
            next_id: self.next_id,
            json_cache: RefCell::new(None),
        };
        serde_json::to_string(&visible).unwrap_or_else(|_| "{}".into())
    }

    fn invalidate_cache(&mut self) {
        *self.json_cache.borrow_mut() = None;
    }

    pub fn add(&mut self, label: &str, kind: NodeKind) -> usize {
        self.add_with_desc(label, "", kind)
    }

    pub fn add_with_desc(&mut self, label: &str, summary: &str, kind: NodeKind) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        let name = label
            .rsplit("::")
            .next()
            .and_then(|tail| tail.rsplit('/').next())
            .unwrap_or(label)
            .to_string();
        self.nodes.push(GraphNode {
            id,
            label: label.to_string(),
            name,
            summary: summary.to_string(),
            kind,
            active: true,
            highlight: false,
            size: 0,
            tokens: 0,
            attachment: None,
            content_hash: None,
            pos: None,
        });
        self.invalidate_cache();
        id
    }

    /// Stores a baked layout position for a node.
    pub fn set_pos(&mut self, id: usize, x: f32, y: f32) {
        if let Some(node) = self.nodes.iter_mut().find(|n| n.id == id) {
            node.pos = Some((x, y));
            self.invalidate_cache();
        }
    }

    /// Activates/deactivates every node whose label matches `selector`
    /// exactly or starts with `selector` as a path/symbol prefix.
    /// Returns how many nodes changed.
    pub fn set_active_by_prefix(&mut self, selector: &str, active: bool) -> usize {
        let mut changed = 0;
        for node in &mut self.nodes {
            let matches = node.label == selector
                || node.name == selector
                || node.label.starts_with(&format!("{selector}/"))
                || node.label.starts_with(&format!("{selector}::"));
            if matches && node.active != active {
                node.active = active;
                changed += 1;
            }
        }
        if changed > 0 {
            self.invalidate_cache();
        }
        changed
    }

    /// Sets a node's summary and the content hash it was generated from
    /// (pass `None` for hand-written summaries with no source content).
    pub fn set_summary(&mut self, id: usize, summary: &str, content_hash: Option<u64>) {
        if let Some(node) = self.nodes.iter_mut().find(|n| n.id == id) {
            node.summary = summary.to_string();
            node.content_hash = content_hash;
            self.invalidate_cache();
        }
    }

    pub fn set_attachment(
        &mut self,
        id: usize,
        path: &str,
        span: Option<(usize, usize)>,
        size: usize,
    ) {
        if let Some(node) = self.nodes.iter_mut().find(|n| n.id == id) {
            node.attachment = Some(Attachment {
                path: path.to_string(),
                span,
            });
            node.size = size;
            self.invalidate_cache();
        }
    }

    pub fn set_tokens(&mut self, id: usize, tokens: usize) {
        if let Some(node) = self.nodes.iter_mut().find(|n| n.id == id) {
            node.tokens = tokens;
            self.invalidate_cache();
        }
    }

    pub fn remove(&mut self, id: usize) {
        self.nodes.retain(|n| n.id != id);
        self.edges.retain(|e| e.from != id && e.to != id);
        self.invalidate_cache();
    }

    pub fn toggle(&mut self, id: usize) {
        if let Some(node) = self.nodes.iter_mut().find(|n| n.id == id) {
            node.active = !node.active;
            self.invalidate_cache();
        }
    }

    pub fn connect(&mut self, from: usize, to: usize) {
        self.connect_kind(from, to, EdgeKind::Contains);
    }

    pub fn connect_kind(&mut self, from: usize, to: usize, kind: EdgeKind) {
        if from == to {
            return;
        }
        if self
            .edges
            .iter()
            .any(|e| e.from == from && e.to == to && e.kind == kind)
        {
            return;
        }
        self.edges.push(GraphEdge { from, to, kind });
        self.invalidate_cache();
    }

    pub fn auto_connect(&mut self) {
        let pairs: Vec<(usize, usize)> = self
            .nodes
            .iter()
            .filter_map(|n| {
                let parent_label = n.label.rfind('/').map(|i| &n.label[..i])?;
                let parent = self.nodes.iter().find(|p| p.label == parent_label)?;
                Some((parent.id, n.id))
            })
            .collect();
        let mut changed = false;
        for (from, to) in pairs {
            if !self.edges.iter().any(|e| e.from == from && e.to == to) {
                self.edges.push(GraphEdge {
                    from,
                    to,
                    kind: EdgeKind::Contains,
                });
                changed = true;
            }
        }
        if changed {
            self.invalidate_cache();
        }
    }

    pub fn edges(&self) -> &[GraphEdge] {
        &self.edges
    }

    pub fn clear_highlights(&mut self) {
        for node in &mut self.nodes {
            node.highlight = false;
        }
        self.invalidate_cache();
    }

    pub fn highlight_by_id(&mut self, ids: &[usize]) {
        for node in &mut self.nodes {
            if ids.contains(&node.id) {
                node.highlight = true;
            }
        }
        self.invalidate_cache();
    }

    pub fn nodes(&self) -> &[GraphNode] {
        &self.nodes
    }

    pub fn active_labels(&self) -> Vec<String> {
        self.nodes
            .iter()
            .filter(|n| n.active)
            .map(|n| n.label.clone())
            .collect()
    }

    pub fn total_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn find_by_label(&self, label: &str) -> Option<usize> {
        self.nodes.iter().find(|n| n.label == label).map(|n| n.id)
    }

    pub fn graph_node_label(&self, id: usize) -> Option<&str> {
        self.nodes
            .iter()
            .find(|n| n.id == id)
            .map(|n| n.label.as_str())
    }

    pub fn save(&self, path: &Path) -> BackendResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn load(path: &Path) -> BackendResult<Self> {
        let json = fs::read_to_string(path)?;
        let g: Self = serde_json::from_str(&json)?;
        Ok(g)
    }

    pub fn scan_workspace(&mut self, root: &Path, prefix: Option<String>) -> BackendResult<usize> {
        use std::sync::atomic::AtomicBool;
        self.scan_workspace_progress(root, prefix, &AtomicBool::new(false), &mut |_| {})
            .map(|r| r.added)
    }

    /// Scans the workspace, calling `progress(entries_walked)`
    /// periodically. `cancel` is checked every iteration so the caller
    /// can abort mid-scan via [`cancel_workspace_scan`].
    /// Designed to run on a background thread on a clone
    /// of the graph: lookups use local indices (the per-entry linear
    /// scans made large repos take minutes) and the node count is
    /// capped so massive repos can't hang the force layout afterwards.
    pub fn scan_workspace_progress(
        &mut self,
        root: &Path,
        prefix: Option<String>,
        cancel: &std::sync::atomic::AtomicBool,
        progress: &mut dyn FnMut(usize),
    ) -> BackendResult<ScanReport> {
        /// Ceiling on nodes added per scan: beyond this the graph view
        /// (O(n²) physics) gets slow. Increased from 4000 as hardware got better.
        const MAX_SCAN_NODES: usize = 50000;

        let root_name = root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "workspace".into());

        // label → id and (from, to, kind) indices for the whole scan;
        // find_by_label / connect are linear scans, O(n²) in aggregate
        let mut by_label: HashMap<String, usize> =
            self.nodes.iter().map(|n| (n.label.clone(), n.id)).collect();
        let mut edge_set: HashSet<(usize, usize, EdgeKind)> =
            self.edges.iter().map(|e| (e.from, e.to, e.kind)).collect();

        if !by_label.contains_key(&root_name) {
            let id = self.add_with_desc(&root_name, "workspace root", NodeKind::Directory);
            by_label.insert(root_name.clone(), id);
        }

        let skip_dirs: [&str; 7] = [
            ".git",
            "node_modules",
            "target",
            ".micelio",
            ".minimal-context",
            ".DS_Store",
            ".opencode",
        ];
        let skip_extensions: [&str; 4] = [".lock", ".exe", ".dll", ".so"];
        let known_extensions: [&str; 19] = [
            ".rs", ".py", ".js", ".ts", ".go", ".rb", ".java", ".c", ".h", ".cpp", ".toml",
            ".json", ".yaml", ".yml", ".md", ".sh", ".sql", ".html", ".css",
        ];
        let known_files: [&str; 5] = [
            "Makefile",
            "Dockerfile",
            ".gitignore",
            "README.md",
            "LICENSE",
        ];

        let mut count = 0usize;
        let mut walked = 0usize;
        let mut truncated = false;

        for entry in ignore::WalkBuilder::new(root) // respects .gitignore
            .hidden(false) // don't skip hidden — our skip_dirs handles it
            .filter_entry(move |e| {
                let name = e.file_name().to_string_lossy();
                !skip_dirs.iter().any(|d| name == *d)
            })
            .build()
            .filter_map(|e| e.ok())
        {
            if count >= MAX_SCAN_NODES {
                truncated = true;
                break;
            }
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                truncated = true;
                break;
            }
            walked += 1;
            if walked.is_multiple_of(256) {
                progress(walked);
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|e| BackendError::Provider(format!("strip: {e}")))?;
            if relative.as_os_str().is_empty() {
                continue;
            }

            let rel_str = relative.to_string_lossy().to_string();
            let label = if let Some(ref pfx) = prefix {
                format!("{pfx}/{rel_str}")
            } else {
                rel_str.clone()
            };

            if let Some(ft) = entry.file_type() {
                if ft.is_dir() {
                    if let std::collections::hash_map::Entry::Vacant(slot) = by_label.entry(label) {
                        let id = self.add_with_desc(slot.key(), "", NodeKind::Directory);
                        slot.insert(id);
                        count += 1;
                    }
                } else if ft.is_file() {
                    let ext = path
                        .extension()
                        .map(|e| format!(".{}", e.to_string_lossy()))
                        .unwrap_or_default();
                    let fname = path
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    if skip_extensions.iter().any(|e| ext == *e) {
                        continue;
                    }
                    if !known_extensions.iter().any(|e| ext == *e)
                        && !known_files.iter().any(|f| fname == *f)
                    {
                        continue;
                    }
                    if !by_label.contains_key(&label) {
                        let size = entry.metadata().map(|m| m.len() as usize).unwrap_or(0);
                        let id = self.add_with_desc(&label, "", NodeKind::File);
                        self.set_attachment(id, &label, None, size);
                        by_label.insert(label.clone(), id);
                        count += 1;

                        // Symbol granularity (tree-sitter) for supported
                        // code files; capped to keep refresh fast.
                        const MAX_PARSE_BYTES: usize = 256 * 1024;
                        let ext_plain = ext.trim_start_matches('.');
                        if size <= MAX_PARSE_BYTES
                            && matches!(
                                ext_plain,
                                "rs" | "py"
                                    | "js"
                                    | "jsx"
                                    | "ts"
                                    | "tsx"
                                    | "go"
                                    | "html"
                                    | "css"
                                    | "c"
                                    | "cpp"
                                    | "cc"
                                    | "h"
                                    | "hpp"
                            )
                        {
                            if let Ok(source) = fs::read_to_string(path) {
                                // Count real tokens for this file
                                self.set_tokens(id, count_tokens(&source));
                                // Skip granular symbol extraction for minified /
                                // generated files (one giant line). Their symbol
                                // spans each cover the whole file, so per-symbol
                                // token counting becomes O(symbols × filesize) —
                                // this is what froze the scan on `*.min.css`.
                                if is_minified(&source) {
                                    continue;
                                }
                                for sym in crate::backend::symbols::extract(ext_plain, &source) {
                                    if count >= MAX_SCAN_NODES
                                        || cancel.load(std::sync::atomic::Ordering::Relaxed)
                                    {
                                        break;
                                    }
                                    let sym_label = format!("{label}::{}", sym.name);
                                    if by_label.contains_key(&sym_label) {
                                        continue;
                                    }
                                    let sym_id = self.add_with_desc(&sym_label, "", sym.kind);
                                    self.set_attachment(
                                        sym_id,
                                        &label,
                                        Some((sym.start_line, sym.end_line)),
                                        sym.byte_len,
                                    );
                                    // Count tokens for the symbol's span
                                    let sym_text =
                                        extract_span(&source, Some((sym.start_line, sym.end_line)));
                                    self.set_tokens(sym_id, count_tokens(&sym_text));
                                    by_label.insert(sym_label, sym_id);
                                    if edge_set.insert((id, sym_id, EdgeKind::Contains)) {
                                        self.edges.push(GraphEdge {
                                            from: id,
                                            to: sym_id,
                                            kind: EdgeKind::Contains,
                                        });
                                    }
                                    count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        progress(walked);

        // --- References pass (Phase C) ---
        // For every extracted symbol, find word-boundary mentions in other
        // files; the edge goes from the enclosing symbol (or the file) to
        // the referenced symbol. It reads every indexed file and searches
        // every symbol name in it (files × symbols), so it is skipped on
        // big scans — that product is what used to lock the app for
        // minutes on massive repos.
        {
            let n_symbols = self
                .nodes
                .iter()
                .filter(|n| matches!(n.kind, NodeKind::Function | NodeKind::Class))
                .count();
            let n_files = self
                .nodes
                .iter()
                .filter(|n| n.kind == NodeKind::File && n.attachment.is_some())
                .count();
            if n_files.saturating_mul(n_symbols) <= 250_000 {
                self.resolve_references(root, cancel);
            }
        }

        // Connect parent-child relationships based on path hierarchy
        let all_labels: Vec<String> = self.nodes.iter().map(|n| n.label.clone()).collect();
        for label in &all_labels {
            let path = Path::new(label);
            if let Some(parent) = path.parent() {
                let parent_label = parent.to_string_lossy().to_string();
                let child_id = by_label.get(label).copied();
                let parent_id = if parent_label.is_empty() {
                    // Direct child of root
                    by_label.get(&root_name).copied()
                } else {
                    by_label.get(&parent_label).copied()
                };
                if let (Some(child), Some(par)) = (child_id, parent_id) {
                    if child != par && edge_set.insert((par, child, EdgeKind::Contains)) {
                        self.edges.push(GraphEdge {
                            from: par,
                            to: child,
                            kind: EdgeKind::Contains,
                        });
                    }
                }
            }
        }

        Ok(ScanReport {
            added: count,
            truncated,
        })
    }

    /// Adds `References` edges by scanning indexed file contents for
    /// mentions of known symbols (VSCode-like textual find-references).
    fn resolve_references(&mut self, root: &Path, cancel: &std::sync::atomic::AtomicBool) {
        // (symbol id, name, file label, span)
        let symbols: Vec<SymbolEntry> = self
            .nodes
            .iter()
            .filter(|n| matches!(n.kind, NodeKind::Function | NodeKind::Class))
            .filter(|n| n.name.len() >= 4) // short names are too noisy
            .filter_map(|n| {
                let att = n.attachment.as_ref()?;
                Some((n.id, n.name.clone(), att.path.clone(), att.span))
            })
            .collect();
        if symbols.is_empty() {
            return;
        }

        // file label -> (file node id, symbols of that file with spans)
        let files: Vec<(usize, String)> = self
            .nodes
            .iter()
            .filter(|n| n.kind == NodeKind::File && n.attachment.is_some())
            .map(|n| (n.id, n.label.clone()))
            .collect();

        let mut new_edges: Vec<(usize, usize)> = Vec::new();
        for (file_id, file_label) in &files {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            let Ok(source) = fs::read_to_string(root.join(file_label)) else {
                continue;
            };
            for (sym_id, name, sym_file, _sym_span) in &symbols {
                if sym_file == file_label {
                    continue; // defined here; mentions are the definition itself
                }
                let Some(line_no) = find_word(&source, name) else {
                    continue;
                };
                // attribute the use to the enclosing symbol when possible
                let from = symbols
                    .iter()
                    .filter(|(_, _, f, span)| {
                        f == file_label && span.is_some_and(|(s, e)| s <= line_no && line_no <= e)
                    })
                    .map(|(id, _, _, _)| *id)
                    .next()
                    .unwrap_or(*file_id);
                new_edges.push((from, *sym_id));
            }
        }
        for (from, to) in new_edges {
            self.connect_kind(from, to, EdgeKind::References);
        }
    }
}

/// First line (1-based) containing `word` with word boundaries, if any.
fn find_word(source: &str, word: &str) -> Option<usize> {
    for (i, line) in source.lines().enumerate() {
        let mut start = 0;
        while let Some(pos) = line[start..].find(word) {
            let abs = start + pos;
            let before_ok = abs == 0
                || !line.as_bytes()[abs - 1].is_ascii_alphanumeric()
                    && line.as_bytes()[abs - 1] != b'_';
            let after = abs + word.len();
            let after_ok = after >= line.len()
                || !line.as_bytes()[after].is_ascii_alphanumeric()
                    && line.as_bytes()[after] != b'_';
            if before_ok && after_ok {
                return Some(i + 1);
            }
            start = abs + word.len();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The graph JSON is the model's map of the workspace. A locked file stays
    /// on the map by name — the model needs to know it's there — but everything
    /// derived from its contents must be gone.
    #[test]
    fn serialize_for_model_keeps_locked_file_but_redacts_its_content() {
        let root = std::env::temp_dir().join(format!("mc-graph-locks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let mut g = KnowledgeGraph::new();
        let public = g.add_with_desc("src/public.rs", "public summary", NodeKind::File);
        g.set_attachment(public, "src/public.rs", None, 10);
        let secret = g.add_with_desc("src/secret.rs", "SECRET SUMMARY", NodeKind::File);
        g.set_attachment(secret, "src/secret.rs", None, 10);
        // A symbol inside the locked file: its very name is content, so it goes.
        let sym = g.add_with_desc(
            "src/secret.rs::api_key",
            "returns the key",
            NodeKind::Function,
        );
        g.set_attachment(sym, "src/secret.rs", Some((1, 3)), 5);
        g.connect_kind(secret, sym, EdgeKind::Contains);

        crate::backend::locks::set_locked(&root, "src/secret.rs", true).unwrap();
        let locks = crate::backend::locks::locked_filter(&root);
        let json = g.serialize_for_model(&locks);

        assert!(
            json.contains("src/public.rs"),
            "unlocked node still present"
        );
        // The file is still on the map, and says why it can't be read.
        assert!(
            json.contains("src/secret.rs"),
            "a locked file must stay visible: {json}"
        );
        assert!(
            json.contains("locked by the user"),
            "no reason given: {json}"
        );
        // ...but nothing that came out of reading it.
        assert!(!json.contains("SECRET SUMMARY"), "locked summary leaked");
        assert!(!json.contains("api_key"), "symbol of a locked file leaked");

        // The symbol is gone and its edge with it, rather than left dangling.
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let nodes = parsed["nodes"].as_array().unwrap();
        assert_eq!(nodes.len(), 2, "only the two file nodes remain");
        let edges = parsed["edges"].as_array().unwrap();
        assert!(edges.is_empty(), "edges to dropped symbols must go");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn serialize_for_model_matches_serialize_when_nothing_is_locked() {
        let root = std::env::temp_dir().join(format!("mc-graph-nolocks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let mut g = KnowledgeGraph::new();
        let id = g.add_with_desc("src/a.rs", "sum", NodeKind::File);
        g.set_attachment(id, "src/a.rs", None, 4);

        let locks = crate::backend::locks::locked_filter(&root);
        assert_eq!(g.serialize_for_model(&locks), g.serialize());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn is_minified_flags_long_lines_only() {
        // Normal multi-line source is not minified.
        let normal = "fn a() {}\nfn b() {}\n".repeat(500);
        assert!(!is_minified(&normal));
        // A single enormous line (e.g. *.min.css) is.
        let minified = format!(".a{{color:red}}{}", "x".repeat(6000));
        assert!(is_minified(&minified));
    }

    #[test]
    fn content_hash_is_stable_and_distinguishes() {
        // Pinned value guards against an accidental algorithm change that
        // would silently invalidate every persisted summary hash.
        assert_eq!(content_hash(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(content_hash("hello"), content_hash("hello"));
        assert_ne!(content_hash("hello"), content_hash("hellp"));
    }

    #[test]
    fn extract_span_is_inclusive_and_1_based() {
        let src = "a\nb\nc\nd";
        assert_eq!(extract_span(src, Some((2, 3))), "b\nc");
        assert_eq!(extract_span(src, Some((1, 1))), "a");
        // Whole file when span is None.
        assert_eq!(extract_span(src, None), src);
        // Out-of-range end clamps to available lines instead of panicking.
        assert_eq!(extract_span(src, Some((3, 99))), "c\nd");
    }

    #[test]
    fn add_derives_name_from_label_tail() {
        let mut g = KnowledgeGraph::new();
        let file = g.add("src/ui/panel.rs", NodeKind::File);
        let sym = g.add("src/ui/panel.rs::draw_chat", NodeKind::Function);
        let names: HashMap<usize, &str> =
            g.nodes().iter().map(|n| (n.id, n.name.as_str())).collect();
        assert_eq!(names[&file], "panel.rs");
        assert_eq!(names[&sym], "draw_chat");
    }

    #[test]
    fn connect_dedups_and_ignores_self_edges() {
        let mut g = KnowledgeGraph::new();
        let a = g.add("a", NodeKind::Concept);
        let b = g.add("b", NodeKind::Concept);
        g.connect(a, b);
        g.connect(a, b); // duplicate Contains — ignored
        g.connect(a, a); // self-edge — ignored
        assert_eq!(g.edges().len(), 1);
        // A different kind between the same pair is a distinct edge.
        g.connect_kind(a, b, EdgeKind::References);
        assert_eq!(g.edges().len(), 2);
    }

    #[test]
    fn auto_connect_links_path_parents() {
        let mut g = KnowledgeGraph::new();
        let dir = g.add("src", NodeKind::Directory);
        let file = g.add("src/main.rs", NodeKind::File);
        g.auto_connect();
        assert!(g.edges().iter().any(|e| e.from == dir && e.to == file));
    }

    #[test]
    fn remove_cascades_to_incident_edges() {
        let mut g = KnowledgeGraph::new();
        let a = g.add("a", NodeKind::Concept);
        let b = g.add("b", NodeKind::Concept);
        let c = g.add("c", NodeKind::Concept);
        g.connect(a, b);
        g.connect(b, c);
        g.remove(b);
        assert_eq!(g.total_count(), 2);
        assert!(g.edges().is_empty(), "edges touching b are dropped");
    }

    #[test]
    fn set_active_by_prefix_matches_label_name_and_descendants() {
        let mut g = KnowledgeGraph::new();
        let dir = g.add("src", NodeKind::Directory);
        let file = g.add("src/main.rs", NodeKind::File);
        let sym = g.add("src/main.rs::run", NodeKind::Function);
        let other = g.add("docs/readme.md", NodeKind::File);

        // Deactivate everything under "src" (label, "src/…", "src::…").
        let changed = g.set_active_by_prefix("src", false);
        assert_eq!(changed, 3);
        let active: HashMap<usize, bool> = g.nodes().iter().map(|n| (n.id, n.active)).collect();
        assert!(!active[&dir] && !active[&file] && !active[&sym]);
        assert!(active[&other], "unrelated subtree untouched");
    }

    #[test]
    fn summary_and_active_labels_track_state() {
        let mut g = KnowledgeGraph::new();
        let a = g.add("a", NodeKind::Concept);
        let b = g.add("b", NodeKind::Concept);
        g.set_summary(a, "first node", Some(content_hash("first node")));
        g.toggle(b); // a stays active, b flips off
        assert_eq!(g.active_labels(), vec!["a".to_string()]);
        let summarized = g.nodes().iter().find(|n| n.id == a).unwrap();
        assert_eq!(summarized.summary, "first node");
        assert!(summarized.content_hash.is_some());
    }

    #[test]
    fn save_load_roundtrip_preserves_graph() {
        let mut g = KnowledgeGraph::new();
        let a = g.add_with_desc("a", "node a", NodeKind::Concept);
        let b = g.add("a/child", NodeKind::File);
        g.connect(a, b);
        g.set_pos(a, 1.5, -2.0);

        let dir = std::env::temp_dir().join(format!("mc-graph-{}", std::process::id()));
        let path = dir.join("graph.json");
        g.save(&path).unwrap();
        let loaded = KnowledgeGraph::load(&path).unwrap();

        assert_eq!(loaded.total_count(), 2);
        assert_eq!(loaded.edges().len(), 1);
        assert_eq!(loaded.find_by_label("a/child"), Some(b));
        let pos = loaded.nodes().iter().find(|n| n.id == a).unwrap().pos;
        assert_eq!(pos, Some((1.5, -2.0)));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn find_word_respects_boundaries_and_is_1_based() {
        let src = "let total = 1;\ncall(total_count);\n  total\n";
        // Line 1 has a real boundary-delimited `total`.
        assert_eq!(find_word(src, "total"), Some(1));
        // `area` only appears inside `total_count`-style joins -> no match.
        assert_eq!(find_word("xtotalx total_count", "total"), None);
        assert_eq!(find_word(src, "missing"), None);
    }

    #[test]
    fn scan_workspace_indexes_files_and_symbols() {
        let dir = std::env::temp_dir().join(format!("mc-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/lib.rs"), "fn alpha() {}\nfn beta() {}\n").unwrap();
        std::fs::write(dir.join("README.md"), "# hi").unwrap();
        // Skipped: unknown extension and ignored dir.
        std::fs::write(dir.join("photo.bin"), "x").unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("node_modules/dep.js"), "fn x(){}").unwrap();

        let mut g = KnowledgeGraph::new();
        let added = g.scan_workspace(&dir, None).unwrap();
        assert!(added > 0);

        let labels: Vec<&str> = g.nodes().iter().map(|n| n.label.as_str()).collect();
        assert!(labels.contains(&"src/lib.rs"));
        assert!(labels.contains(&"README.md"));
        assert!(labels.iter().any(|l| l.ends_with("::alpha")));
        assert!(!labels.iter().any(|l| l.contains("photo.bin")));
        assert!(!labels.iter().any(|l| l.contains("node_modules")));

        // A file node carries a token count and an attachment.
        let lib = g.nodes().iter().find(|n| n.label == "src/lib.rs").unwrap();
        assert!(lib.tokens > 0 && lib.attachment.is_some());

        let _ = std::fs::remove_dir_all(dir);
    }
}
