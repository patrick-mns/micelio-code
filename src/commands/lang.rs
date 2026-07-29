//! Extension → syntax-highlighting language, shared by every command that hands
//! source text to the webview. The ids are Prism's, since that's what the
//! frontend's viewer registers.

/// Map a file extension to a Prism language id. Falls back to plain text.
pub(crate) fn lang_from_path(path: &str) -> String {
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

/// True for files the viewer should show as a picture rather than as text.
/// SVG counts: it renders as an image even though its bytes are markup, so the
/// viewer can offer both.
pub(crate) fn is_image_path(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_recognized_by_extension() {
        assert!(is_image_path("icons/icon_32x32.PNG"));
        assert!(is_image_path("logo.svg"));
        assert!(!is_image_path("README.md"));
        // No extension at all must not be mistaken for one.
        assert!(!is_image_path("Makefile"));
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
