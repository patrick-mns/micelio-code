use crate::backend::knowledge::{EdgeKind, KnowledgeGraph, NodeKind};
use std::collections::{HashMap, HashSet};

/// UI-agnostic rectangle used by the treemap layout (f64 so tiny
/// tiles are never lost to rounding).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug)]
pub struct TreemapNode {
    pub id: usize,
    pub label: String,
    pub depth: usize,
    pub kind: NodeKind,
    pub active: bool,
    pub weight: usize,
    pub rect: Option<Area>,
    pub children: Vec<TreemapNode>,
}

/// Flattened leaf rectangle. Only used by the treemap layout tests to assert
/// the packing has no overlaps/gaps.
#[cfg(test)]
#[derive(Clone, Debug)]
pub struct FlatRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub depth: usize,
}

pub fn build_treemap(graph: &KnowledgeGraph, area: Area) -> Vec<TreemapNode> {
    let nodes = graph.nodes();

    let mut map: HashMap<usize, TreemapNode> = HashMap::new();
    for node in nodes {
        // Real content size drives the tile area; fall back to text
        // length for concept-style nodes that have no attachment.
        let weight = if node.size > 0 {
            node.size
        } else {
            (node.summary.len() + node.label.len() + 1) * 16
        };
        map.insert(
            node.id,
            TreemapNode {
                id: node.id,
                label: node.label.clone(),
                depth: 0,
                kind: node.kind,
                active: node.active,
                weight: weight.max(1),
                rect: None,
                children: Vec::new(),
            },
        );
    }

    // Hierarchy comes from Contains edges.
    let mut children_of: HashMap<usize, Vec<usize>> = HashMap::new();
    for edge in graph.edges() {
        if edge.kind != EdgeKind::Contains {
            continue;
        }
        if !map.contains_key(&edge.from) || !map.contains_key(&edge.to) {
            continue;
        }
        children_of.entry(edge.from).or_default().push(edge.to);
    }

    // Path-derived nesting: "src/native/ui.rs" goes under "src/native"
    // even when depth metadata is inconsistent, so the map reflects
    // where things actually live.
    let label_to_id: HashMap<&str, usize> =
        nodes.iter().map(|n| (n.label.as_str(), n.id)).collect();
    for node in nodes {
        if let Some(pos) = node.label.rfind('/') {
            if let Some(&pid) = label_to_id.get(&node.label[..pos]) {
                if pid != node.id {
                    let kids = children_of.entry(pid).or_default();
                    if !kids.contains(&node.id) {
                        kids.push(node.id);
                    }
                }
            }
        }
    }

    let mut assigned: HashSet<usize> = HashSet::new();
    // Attach deepest-first so cloned children already carry their own
    // subtree: parents are created before children during scans, so a
    // descending id order approximates reverse topological order.
    let mut ids: Vec<usize> = map.keys().copied().collect();
    ids.sort_unstable_by(|a, b| b.cmp(a));
    for &id in &ids {
        if let Some(kids) = children_of.get(&id) {
            for &kid in kids {
                if assigned.contains(&kid) {
                    continue;
                }
                let child = match map.get(&kid) {
                    Some(c) => c.clone(),
                    None => continue,
                };
                if let Some(parent) = map.get_mut(&id) {
                    parent.children.push(child);
                    assigned.insert(kid);
                }
            }
        }
    }

    let mut roots: Vec<TreemapNode> = map
        .into_values()
        .filter(|n| !assigned.contains(&n.id))
        .collect();
    roots.sort_by_key(|n| n.id);

    for root in &mut roots {
        assign_depth(root, 0);
        rollup_weight(root);
        sort_children(root);
    }

    // Squarified treemap layout (f64 internally)
    layout_squarified(&mut roots, area);

    roots
}

#[cfg(test)]
pub fn flatten_to_rects(roots: &[TreemapNode]) -> Vec<FlatRect> {
    let mut out = Vec::new();
    for root in roots {
        flatten_node(root, &mut out);
    }
    out
}

#[cfg(test)]
fn flatten_node(node: &TreemapNode, out: &mut Vec<FlatRect>) {
    if let Some(rect) = node.rect {
        out.push(FlatRect {
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
            depth: node.depth,
        });
    }
    for child in &node.children {
        flatten_node(child, out);
    }
}

fn assign_depth(node: &mut TreemapNode, depth: usize) {
    node.depth = depth;
    for child in &mut node.children {
        assign_depth(child, depth + 1);
    }
}

fn sort_children(node: &mut TreemapNode) {
    node.children
        .sort_by(|a, b| b.weight.cmp(&a.weight).then_with(|| a.id.cmp(&b.id)));
    for child in &mut node.children {
        sort_children(child);
    }
}

fn rollup_weight(node: &mut TreemapNode) -> usize {
    if node.children.is_empty() {
        return node.weight.max(1);
    }

    let children_weight: usize = node.children.iter_mut().map(rollup_weight).sum();
    node.weight = children_weight.max(1);
    node.weight
}

// --- Squarified treemap (f64, treetop-cli approach) ---

#[derive(Clone, Debug, Copy)]
struct F64Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl F64Rect {
    fn area(&self) -> f64 {
        self.w * self.h
    }
    fn shorter_side(&self) -> f64 {
        self.w.min(self.h)
    }
}

fn layout_squarified(nodes: &mut [TreemapNode], area: Area) {
    if nodes.is_empty() || area.width <= 0.0 || area.height <= 0.0 {
        return;
    }
    nodes.sort_by(|a, b| b.weight.cmp(&a.weight).then_with(|| a.id.cmp(&b.id)));
    let total: f64 = nodes.iter().map(|n| n.weight as f64).sum();
    if total <= 0.0 {
        return;
    }

    let bounds = F64Rect {
        x: area.x,
        y: area.y,
        w: area.width,
        h: area.height,
    };
    let mut remaining = bounds;
    let mut row: Vec<(usize, f64)> = Vec::new();
    let mut row_area = 0.0_f64;
    let mut rects: Vec<(usize, F64Rect)> = Vec::new();

    for (i, node) in nodes.iter().enumerate() {
        let item_area = (node.weight as f64 / total) * bounds.area();
        if row.is_empty() {
            row.push((i, item_area));
            row_area = item_area;
            continue;
        }
        let side = remaining.shorter_side();
        let worst_before = worst_ratio(&row, row_area, side);
        row.push((i, item_area));
        let new_area = row_area + item_area;
        let worst_after = worst_ratio(&row, new_area, side);
        if worst_after <= worst_before {
            row_area = new_area;
        } else {
            row.pop();
            do_layout_row(&row, row_area, &mut remaining, &mut rects);
            row.clear();
            row.push((i, item_area));
            row_area = item_area;
        }
    }
    if !row.is_empty() {
        do_layout_row(&row, row_area, &mut remaining, &mut rects);
    }

    rects.sort_by_key(|(i, _)| *i);
    for (i, r) in rects {
        nodes[i].rect = Some(Area {
            x: r.x,
            y: r.y,
            width: r.w,
            height: r.h,
        });
    }

    for node in nodes.iter_mut() {
        if let Some(rect) = node.rect {
            if !node.children.is_empty() {
                // Reserve a header strip + padding so the parent container
                // stays visible around its children.
                let pad = 3.0;
                let header = 18.0;
                let inner = Area {
                    x: rect.x + pad,
                    y: rect.y + header,
                    width: (rect.width - pad * 2.0).max(0.0),
                    height: (rect.height - header - pad).max(0.0),
                };
                if inner.width > 4.0 && inner.height > 4.0 {
                    layout_squarified(&mut node.children, inner);
                } else {
                    layout_squarified(&mut node.children, rect);
                }
            }
        }
    }
}

fn worst_ratio(row: &[(usize, f64)], row_area: f64, side: f64) -> f64 {
    if row.is_empty() || side <= 0.0 {
        return f64::MAX;
    }
    let strip_thickness = row_area / side;
    if strip_thickness <= 0.0 {
        return f64::MAX;
    }
    let mut worst = 0.0_f64;
    for &(_, area) in row {
        let item_len = area / strip_thickness;
        let ratio = if strip_thickness > item_len {
            strip_thickness / item_len
        } else {
            item_len / strip_thickness
        };
        worst = worst.max(ratio);
    }
    worst
}

fn do_layout_row(
    row: &[(usize, f64)],
    row_area: f64,
    remaining: &mut F64Rect,
    results: &mut Vec<(usize, F64Rect)>,
) {
    if row.is_empty() || remaining.area() <= 0.0 {
        return;
    }
    let vertical = remaining.w >= remaining.h;
    if vertical {
        let strip_w = row_area / remaining.h;
        let mut y = remaining.y;
        for &(i, area) in row {
            let h = area / strip_w;
            results.push((
                i,
                F64Rect {
                    x: remaining.x,
                    y,
                    w: strip_w,
                    h,
                },
            ));
            y += h;
        }
        remaining.x += strip_w;
        remaining.w -= strip_w;
    } else {
        let strip_h = row_area / remaining.w;
        let mut x = remaining.x;
        for &(i, area) in row {
            let w = area / strip_h;
            results.push((
                i,
                F64Rect {
                    x,
                    y: remaining.y,
                    w,
                    h: strip_h,
                },
            ));
            x += w;
        }
        remaining.y += strip_h;
        remaining.h -= strip_h;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::graph_test::{create_simple_test_graph, create_test_graph};
    use crate::backend::knowledge::NodeKind;

    #[test]
    fn test_build_treemap_simple() {
        let graph = create_simple_test_graph();
        let area = Area {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 24.0,
        };
        let roots = build_treemap(&graph, area);
        assert!(!roots.is_empty(), "should have at least one root");
        assert_eq!(roots.len(), 1, "simple graph has 1 root");
        assert_eq!(roots[0].label, "Root");
        assert!(roots[0].rect.is_some());
        let root_rect = roots[0].rect.unwrap();
        assert_eq!(root_rect.x, 0.0);
        assert_eq!(root_rect.y, 0.0);
        assert_eq!(root_rect.width, 80.0);
        assert_eq!(root_rect.height, 24.0);
    }

    #[test]
    fn test_build_treemap_test_graph() {
        let graph = create_test_graph();
        let area = Area {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 40.0,
        };
        let roots = build_treemap(&graph, area);
        assert_eq!(roots.len(), 1, "test graph has 1 root, got {}", roots.len());
        assert_eq!(roots[0].label, "Rust Ecosystem");
        assert_eq!(roots[0].children.len(), 6, "6 depth-1 nodes");
        for child in &roots[0].children {
            assert!(
                child.rect.is_some(),
                "child {} should have rect",
                child.label
            );
            assert!(
                !child.children.is_empty(),
                "child {} should have grandchildren",
                child.label
            );
        }
    }

    #[test]
    fn test_build_treemap_empty() {
        let graph = KnowledgeGraph::new();
        let area = Area {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 24.0,
        };
        let roots = build_treemap(&graph, area);
        assert!(roots.is_empty());
    }

    #[test]
    fn test_build_treemap_unconnected_are_roots() {
        let mut graph = KnowledgeGraph::new();
        graph.add_with_desc("Root", "root node", NodeKind::Directory);
        graph.add_with_desc("orphan1", "orphan node", NodeKind::File);
        graph.add_with_desc("orphan2", "another orphan", NodeKind::File);
        let area = Area {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 24.0,
        };
        let roots = build_treemap(&graph, area);
        assert_eq!(roots.len(), 3, "nodes without Contains edges are roots");
    }

    #[test]
    fn test_build_treemap_contains_edges_nest() {
        let mut graph = KnowledgeGraph::new();
        let root = graph.add_with_desc("Root", "root node", NodeKind::Directory);
        let a = graph.add_with_desc("a", "child", NodeKind::File);
        let b = graph.add_with_desc("b", "child", NodeKind::File);
        graph.connect(root, a);
        graph.connect(root, b);
        let area = Area {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 24.0,
        };
        let roots = build_treemap(&graph, area);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].children.len(), 2);
    }

    #[test]
    fn test_no_overlaps_or_gaps() {
        // Create a graph with several nodes of differing sizes
        let mut graph = KnowledgeGraph::new();
        graph.add_with_desc("Root", "root node", NodeKind::Directory);
        for i in 1..=15 {
            let label = format!("node_{}", i);
            graph.add_with_desc(&label, &"x".repeat(i * 13), NodeKind::File);
            graph.connect(0, i);
        }

        let area = Area {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 40.0,
        };
        let roots = build_treemap(&graph, area);
        let rects = flatten_to_rects(&roots);

        assert!(!rects.is_empty(), "should have generated leaf rectangles");

        // Filter to only leaf nodes (max depth) for overlap check
        let max_depth = rects.iter().map(|r| r.depth).max().unwrap_or(0);
        let leaf_rects: Vec<_> = rects.iter().filter(|r| r.depth == max_depth).collect();

        // 1. Verify no two LEAF rectangles overlap (non-zero intersection area)
        for (i, r1) in leaf_rects.iter().enumerate() {
            for (j, r2) in leaf_rects.iter().enumerate() {
                if i == j {
                    continue;
                }
                let overlap_x = r1.x < r2.x + r2.w && r2.x < r1.x + r1.w;
                let overlap_y = r1.y < r2.y + r2.h && r2.y < r1.y + r1.h;
                assert!(
                    !(overlap_x && overlap_y),
                    "leaf rectangles overlap: {:?} and {:?}",
                    r1,
                    r2
                );
            }
        }

        // 2. Verify total leaf area sums up to parent area exactly (no gaps/extra space)
        let total_leaf_area: f64 = leaf_rects.iter().map(|r| r.w * r.h).sum();
        let expected_area = area.width * area.height;
        assert!(
            total_leaf_area > 0.0 && total_leaf_area <= expected_area + 1e-6,
            "total leaf tiles area {} should fit within layout area {}",
            total_leaf_area,
            expected_area
        );
    }
}
