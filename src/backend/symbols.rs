//! Symbol extraction via tree-sitter (Phase B of docs/GRAPH_ENGINE.md).
//! Gives the graph VSCode-like granularity: functions/classes per file
//! with exact line spans, so the treemap can show what lives inside
//! each file and weights reflect real content size.

use crate::backend::knowledge::NodeKind;
use tree_sitter::{Node, Parser};

pub struct Symbol {
    pub name: String,
    pub kind: NodeKind,
    pub start_line: usize,
    pub end_line: usize,
    pub byte_len: usize,
}

/// Extracts symbols from `source` based on the file extension.
/// Unsupported languages return an empty list.
pub fn extract(extension: &str, source: &str) -> Vec<Symbol> {
    let language = match extension {
        "rs" => tree_sitter_rust::LANGUAGE.into(),
        "py" => tree_sitter_python::LANGUAGE.into(),
        "js" | "jsx" => tree_sitter_javascript::LANGUAGE.into(),
        "ts" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "tsx" => tree_sitter_typescript::LANGUAGE_TSX.into(),
        "go" => tree_sitter_go::LANGUAGE.into(),
        "html" => tree_sitter_html::LANGUAGE.into(),
        "css" => tree_sitter_css::LANGUAGE.into(),
        "c" => tree_sitter_c::LANGUAGE.into(),
        "cpp" | "cc" | "h" | "hpp" => tree_sitter_cpp::LANGUAGE.into(),
        _ => return Vec::new(),
    };

    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    collect(tree.root_node(), extension, source, &mut out);
    out
}

fn collect(node: Node, extension: &str, source: &str, out: &mut Vec<Symbol>) {
    let mapped = match (extension, node.kind()) {
        ("rs", "function_item") => Some(NodeKind::Function),
        ("rs", "struct_item" | "enum_item" | "trait_item") => Some(NodeKind::Class),
        ("py", "function_definition") => Some(NodeKind::Function),
        ("py", "class_definition") => Some(NodeKind::Class),
        (
            "js" | "jsx" | "ts" | "tsx",
            "function_declaration" | "method_definition" | "generator_function_declaration",
        ) => Some(NodeKind::Function),
        ("js" | "jsx" | "ts" | "tsx", "class_declaration") => Some(NodeKind::Class),
        ("ts" | "tsx", "interface_declaration" | "enum_declaration") => Some(NodeKind::Class),
        ("go", "function_declaration" | "method_declaration") => Some(NodeKind::Function),
        ("go", "type_declaration") => Some(NodeKind::Class),
        ("c" | "cpp" | "cc" | "h" | "hpp", "function_definition") => Some(NodeKind::Function),
        (
            "c" | "cpp" | "cc" | "h" | "hpp",
            "struct_specifier"
            | "class_specifier"
            | "enum_specifier"
            | "namespace_definition"
            | "template_declaration",
        ) => Some(NodeKind::Class),
        ("css", "rule_set" | "media_statement") => Some(NodeKind::Class),
        ("html", "element") => {
            // Check HTML element relevance before mapping
            if let Some(name) = find_html_name(node, source) {
                let is_custom = name.contains('-');
                let is_structural = name.contains('#')
                    || name.contains('.')
                    || matches!(
                        name.split(['#', '.']).next().unwrap_or(""),
                        "main"
                            | "header"
                            | "footer"
                            | "nav"
                            | "section"
                            | "article"
                            | "form"
                            | "aside"
                            | "canvas"
                            | "svg"
                            | "script"
                            | "style"
                    );
                if is_custom || is_structural {
                    Some(NodeKind::Class)
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    };

    if let Some(kind) = mapped {
        if let Some(name) = symbol_name(node, source) {
            out.push(Symbol {
                name,
                kind,
                start_line: node.start_position().row + 1,
                end_line: node.end_position().row + 1,
                byte_len: node.byte_range().len(),
            });
        }
    }

    // Recurse: captures methods inside impl blocks / nested defs.
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect(child, extension, source, out);
    }
}

fn symbol_name(node: Node, source: &str) -> Option<String> {
    match node.kind() {
        "rule_set" | "media_statement" => find_css_name(node, source),
        "element" => find_html_name(node, source),
        "function_definition" if node.child_by_field_name("declarator").is_some() => {
            find_c_function_name(node, source)
        }
        _ => {
            if let Some(name_node) = node.child_by_field_name("name") {
                return source.get(name_node.byte_range()).map(|s| s.to_string());
            }
            // Go: type_declaration → type_spec(name); JS: anonymous default exports
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if let Some(name_node) = child.child_by_field_name("name") {
                    return source.get(name_node.byte_range()).map(|s| s.to_string());
                }
            }
            None
        }
    }
}

fn find_c_function_name(node: Node, source: &str) -> Option<String> {
    let mut current = node.child_by_field_name("declarator")?;
    loop {
        match current.kind() {
            "identifier" | "field_identifier" | "type_identifier" => {
                return source.get(current.byte_range()).map(|s| s.to_string());
            }
            "function_declarator"
            | "pointer_declarator"
            | "reference_declarator"
            | "init_declarator" => {
                if let Some(child) = current.child_by_field_name("declarator") {
                    current = child;
                } else {
                    return find_first_identifier_of_kind(
                        current,
                        source,
                        &["identifier", "field_identifier"],
                    );
                }
            }
            _ => {
                return find_first_identifier_of_kind(
                    current,
                    source,
                    &["identifier", "field_identifier"],
                );
            }
        }
    }
}

fn find_first_identifier_of_kind(node: Node, source: &str, kinds: &[&str]) -> Option<String> {
    if kinds.contains(&node.kind()) {
        return source.get(node.byte_range()).map(|s| s.to_string());
    }
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i as u32) {
            if let Some(name) = find_first_identifier_of_kind(child, source, kinds) {
                return Some(name);
            }
        }
    }
    None
}

fn find_css_name(node: Node, source: &str) -> Option<String> {
    if node.kind() == "media_statement" {
        let mut end_bytes = node.end_byte();
        for i in 0..node.child_count() {
            if let Some(child) = node.child(i as u32) {
                if child.kind() == "block" {
                    end_bytes = child.start_byte();
                    break;
                }
            }
        }
        return source
            .get(node.start_byte()..end_bytes)
            .map(|s| s.trim().to_string());
    }

    if let Some(selectors_node) = node.child_by_field_name("selectors") {
        return source
            .get(selectors_node.byte_range())
            .map(|s| s.trim().to_string());
    }
    if let Some(selector_node) = node.child_by_field_name("selector") {
        return source
            .get(selector_node.byte_range())
            .map(|s| s.trim().to_string());
    }
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i as u32) {
            if child.kind() == "selectors" || child.kind() == "selector" {
                return source.get(child.byte_range()).map(|s| s.trim().to_string());
            }
        }
    }
    None
}

fn find_html_name(node: Node, source: &str) -> Option<String> {
    let start_tag = if node.kind() == "start_tag" {
        Some(node)
    } else if let Some(st) = node.child_by_field_name("start_tag") {
        Some(st)
    } else {
        let mut found = None;
        for i in 0..node.child_count() {
            if let Some(child) = node.child(i as u32) {
                if child.kind() == "start_tag" {
                    found = Some(child);
                    break;
                }
            }
        }
        found
    };

    let mut tag_node = start_tag.and_then(|st| st.child_by_field_name("tag_name"));
    if tag_node.is_none() {
        if let Some(st) = start_tag {
            for j in 0..st.child_count() {
                if let Some(sub) = st.child(j as u32) {
                    if sub.kind() == "tag_name" {
                        tag_node = Some(sub);
                        break;
                    }
                }
            }
        }
    }
    let tag_node = tag_node?;
    let tag_name = source.get(tag_node.byte_range())?.to_string();

    let mut id_attr = None;
    let mut class_attr = None;

    if let Some(st) = start_tag {
        for i in 0..st.child_count() {
            if let Some(attr) = st.child(i as u32) {
                if attr.kind() == "attribute" {
                    let mut name_node = attr.child_by_field_name("name");
                    let mut value_node = attr.child_by_field_name("value");
                    if name_node.is_none() || value_node.is_none() {
                        for j in 0..attr.child_count() {
                            if let Some(sub) = attr.child(j as u32) {
                                if sub.kind() == "attribute_name" {
                                    name_node = Some(sub);
                                } else if sub.kind() == "attribute_value"
                                    || sub.kind() == "quoted_attribute_value"
                                {
                                    value_node = Some(sub);
                                }
                            }
                        }
                    }

                    if let (Some(n), Some(v)) = (name_node, value_node) {
                        let attr_name = source.get(n.byte_range()).unwrap_or("");
                        let attr_val = source
                            .get(v.byte_range())
                            .unwrap_or("")
                            .trim_matches('"')
                            .trim_matches('\'');
                        if attr_name == "id" {
                            id_attr = Some(attr_val.to_string());
                        } else if attr_name == "class" && class_attr.is_none() {
                            class_attr = Some(attr_val.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Some(id) = id_attr {
        Some(format!("{tag_name}#{id}"))
    } else if let Some(class) = class_attr {
        let first_class = class.split_whitespace().next().unwrap_or("");
        if !first_class.is_empty() {
            Some(format!("{tag_name}.{first_class}"))
        } else {
            Some(tag_name)
        }
    } else {
        Some(tag_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_rust_symbols() {
        let src = r#"
pub struct Foo { x: u32 }

impl Foo {
    pub fn new() -> Self { Self { x: 0 } }
}

fn helper() {}
"#;
        let syms = extract("rs", src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"Foo"));
        assert!(names.contains(&"new"), "method inside impl");
        assert!(names.contains(&"helper"));
        let helper = syms.iter().find(|s| s.name == "helper").unwrap();
        assert_eq!(helper.kind, NodeKind::Function);
        assert!(helper.byte_len > 0);
    }

    #[test]
    fn extracts_python_symbols() {
        let src = "class A:\n    def method(self):\n        pass\n\ndef top():\n    pass\n";
        let syms = extract("py", src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"A"));
        assert!(names.contains(&"method"));
        assert!(names.contains(&"top"));
    }

    #[test]
    fn extracts_js_and_go_symbols() {
        let js = "class Widget {}\nfunction render() {}\n";
        let names: Vec<String> = extract("js", js).into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"Widget".to_string()));
        assert!(names.contains(&"render".to_string()));

        let go = "package main\n\ntype Server struct{}\n\nfunc Run() {}\n";
        let names: Vec<String> = extract("go", go).into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"Server".to_string()), "{names:?}");
        assert!(names.contains(&"Run".to_string()));
    }

    #[test]
    fn extracts_html_and_css_symbols() {
        let html = r#"
            <div id="header">
                <span>Ignored inner tag</span>
            </div>
            <section class="hero secondary-class">
                <my-web-component></my-web-component>
            </section>
        "#;
        let syms = extract("html", html);
        let names: Vec<String> = syms.into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"div#header".to_string()));
        assert!(names.contains(&"section.hero".to_string()));
        assert!(names.contains(&"my-web-component".to_string()));
        assert!(!names.contains(&"span".to_string()));

        let css = r#"
            .btn-primary:hover, button {
                color: red;
            }
            @media (max-width: 600px) {
                body { background: blue; }
            }
        "#;
        let syms_css = extract("css", css);
        let names_css: Vec<String> = syms_css.into_iter().map(|s| s.name).collect();
        assert!(names_css.contains(&".btn-primary:hover, button".to_string()));
        assert!(names_css.contains(&"@media (max-width: 600px)".to_string()));
    }

    #[test]
    fn extracts_c_and_cpp_symbols() {
        let c_src = r#"
            struct Point { int x; int y; };
            void print_point(struct Point p) {
                // ...
            }
        "#;
        let syms = extract("c", c_src);
        let names: Vec<String> = syms.into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"Point".to_string()));
        assert!(names.contains(&"print_point".to_string()));
    }

    #[test]
    fn unsupported_language_is_empty() {
        assert!(extract("md", "# title").is_empty());
    }
}
