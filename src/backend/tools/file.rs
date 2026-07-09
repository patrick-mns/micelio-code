use super::{ToolContext, ToolResult};
use std::fs;

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "tiff", "tif",
];

/// Whether `path` looks like an image by extension. Shared with the vision
/// paths (node summaries, the `vision` tool) so they agree on what's an image.
pub fn is_image_path(path: &str) -> bool {
    let p = path.to_lowercase();
    IMAGE_EXTENSIONS
        .iter()
        .any(|ext| p.ends_with(&format!(".{ext}")))
}

/// MIME type for an image path, for data-URL construction. Falls back to png.
pub fn image_mime(path: &str) -> &'static str {
    let p = path.to_lowercase();
    if p.ends_with(".jpg") || p.ends_with(".jpeg") {
        "image/jpeg"
    } else if p.ends_with(".gif") {
        "image/gif"
    } else if p.ends_with(".webp") {
        "image/webp"
    } else if p.ends_with(".bmp") {
        "image/bmp"
    } else if p.ends_with(".svg") {
        "image/svg+xml"
    } else if p.ends_with(".ico") {
        "image/x-icon"
    } else if p.ends_with(".tiff") || p.ends_with(".tif") {
        "image/tiff"
    } else {
        "image/png"
    }
}

#[derive(Debug)]
struct FileResult {
    path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
    added: usize,
    removed: usize,
    content: String,
}

pub fn run(arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let action = super::get_string_field(arguments, "action").unwrap_or_else(|| "read".to_string());
    let path = match super::get_string_field(arguments, "path") {
        Some(p) => p,
        None => {
            // If the arguments are a bare string (not JSON), try it as the path.
            let trimmed = arguments.trim().trim_matches('"');
            if !trimmed.is_empty() && !trimmed.starts_with('{') && !trimmed.starts_with('\"') {
                trimmed.to_string()
            } else {
                return Err(format!(
                    "tool call missing `path` — arguments received: `{arguments}`"
                ));
            }
        }
    };

    let result = match action.as_str() {
        "read" => read(&path, arguments, context)?,
        "write" => write(&path, arguments, context)?,
        "edit" => edit(&path, arguments, context)?,
        other => return Err(format!("unknown action `{other}` (use: read, write, edit)")),
    };

    Ok(ToolResult {
        content: format_result(&result),
    })
}

fn read(path: &str, arguments: &str, context: &ToolContext) -> Result<FileResult, String> {
    if is_image_path(path) {
        return Err(format!(
            "`{path}` is an image — the `file` tool reads text only. \
         Use the `vision` tool to look at it and get a description."
        ));
    }

    let full_path = context.resolve_path(path);

    // If the path is a directory, list its contents instead of failing.
    if full_path.is_dir() {
        return list_directory(&full_path, path);
    }

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("failed to read {}: {e}", full_path.display()))?;

    let start_line = super::get_int_field(arguments, "start_line");
    let limit = super::get_int_field(arguments, "limit");

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();

    let (from, to) = match (start_line, limit) {
        (None, None) => (0, total),
        (Some(s), lim) => {
            let from = (s.max(1) as usize - 1).min(total);
            let to = match lim {
                Some(l) => (from + l.max(0) as usize).min(total),
                None => total,
            };
            (from, to)
        }
        (None, Some(l)) => (0, (l.max(0) as usize).min(total)),
    };

    let width = to.to_string().len().max(2);
    let mut out = String::new();
    for (i, line) in lines[from..to].iter().enumerate() {
        let n = from + i + 1;
        out.push_str(&format!("{n:>width$}\t{line}\n", width = width));
    }
    if from > 0 || to < total {
        out.push_str(&format!(
            "\n[showing lines {}-{} of {}]\n",
            from + 1,
            to,
            total
        ));
    }

    Ok(FileResult {
        path: path.to_string(),
        start_line: if from > 0 { Some(from + 1) } else { None },
        end_line: if to < total { Some(to) } else { None },
        added: 0,
        removed: 0,
        content: out,
    })
}

/// List directory contents in a compact tree-like format.
fn list_directory(dir: &std::path::Path, display_path: &str) -> Result<FileResult, String> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("failed to list {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut lines = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            lines.push(format!("{}/", name));
        } else {
            lines.push(name);
        }
    }

    let content = format!(
        "directory listing — {} entries\n{}",
        lines.len(),
        lines.join("\n")
    );
    Ok(FileResult {
        path: display_path.to_string(),
        start_line: Some(1),
        end_line: Some(lines.len()),
        added: 0,
        removed: 0,
        content,
    })
}

/// Extract the write payload from tool arguments. Smaller models often name
/// the payload differently — accept common aliases before giving up, so a
/// write doesn't fail just over the field name. Shared by the real `write`
/// action and by the review-mode interception in `commands::agent`, so both
/// paths agree on what "the content to write" means.
pub fn resolve_write_content(arguments: &str) -> Result<String, String> {
    [
        "content",
        "contents",
        "text",
        "file_text",
        "body",
        "data",
        "value",
    ]
    .iter()
    .find_map(|k| super::get_string_field(arguments, k))
    .ok_or_else(|| "tool call missing `content` (the text to write into the file)".to_string())
}

fn write(path: &str, arguments: &str, context: &ToolContext) -> Result<FileResult, String> {
    let content = resolve_write_content(arguments)?;
    let full_path = context.resolve_path(path);

    fs::write(&full_path, &content)
        .map_err(|e| format!("failed to write {}: {e}", full_path.display()))?;

    let line_count = content.lines().count();
    Ok(FileResult {
        path: path.to_string(),
        start_line: Some(1),
        end_line: Some(line_count),
        added: line_count,
        removed: 0,
        content: format!("created file ({} lines)\n", line_count),
    })
}

/// Validate an edit's `old_string`/`new_string` against the file's current
/// content and compute the replaced content. Shared by the real `edit` action
/// and by the review-mode interception in `commands::agent`, so a rejected or
/// ambiguous edit is caught the same way regardless of whether review mode is
/// on — the interception no longer gets to silently "succeed" on a no-op.
///
/// Returns `(after_content, occurrences, replace_all)`.
pub fn resolve_edit_content(
    before_content: &str,
    arguments: &str,
    display_path: &str,
) -> Result<(String, usize, bool), String> {
    let old_string = super::get_string_field(arguments, "old_string")
    .ok_or_else(|| "tool call missing `old_string` — for edit you must include both `old_string` (exact text to find) and `new_string` (replacement text)".to_string())?;
    let new_string = super::get_string_field(arguments, "new_string")
    .ok_or_else(|| "tool call missing `new_string` — for edit you must include both `old_string` (exact text to find) and `new_string` (replacement text)".to_string())?;
    let replace_all = super::get_bool_field(arguments, "replace_all").unwrap_or(false);

    if old_string == new_string {
        return Err("old_string and new_string are identical — nothing to change".into());
    }

    let occurrences = before_content.matches(&old_string).count();
    if occurrences == 0 {
        return Err(format!(
      "old_string not found in {display_path} — read the file first to copy the exact text (including whitespace)"
    ));
    }
    if occurrences > 1 && !replace_all {
        return Err(format!(
      "old_string appears {occurrences} times in {display_path} — add more surrounding context to make it unique, or set replace_all:true"
    ));
    }

    let after_content = if replace_all {
        before_content.replace(&old_string, &new_string)
    } else {
        before_content.replacen(&old_string, &new_string, 1)
    };

    Ok((after_content, occurrences, replace_all))
}

fn edit(path: &str, arguments: &str, context: &ToolContext) -> Result<FileResult, String> {
    let full_path = context.resolve_path(path);
    let before_content = fs::read_to_string(&full_path)
        .map_err(|e| format!("failed to read {}: {e}", full_path.display()))?;

    let (after_content, occurrences, replace_all) =
        resolve_edit_content(&before_content, arguments, &full_path.display().to_string())?;

    let old_string = super::get_string_field(arguments, "old_string").unwrap_or_default();

    fs::write(&full_path, &after_content)
        .map_err(|e| format!("failed to write {}: {e}", full_path.display()))?;

    let label = if replace_all {
        format!("replaced {occurrences} occurrence(s)")
    } else {
        "replaced 1 occurrence".into()
    };

    // Generate unified diff with context
    let before_lines: Vec<&str> = before_content.lines().collect();
    let after_lines: Vec<&str> = after_content.lines().collect();

    let (removed, added, diff_output) = generate_unified_diff(&before_lines, &after_lines, path);
    let final_output = format!("{label}\n\n{}", diff_output);

    // Find line numbers of the change
    let old_lines = old_string.lines().count();
    let lines_before: usize = before_content[..before_content.find(&old_string).unwrap_or(0)]
        .lines()
        .count();
    let start_line = lines_before + 1;
    let end_line = start_line + old_lines.saturating_sub(1);

    Ok(FileResult {
        path: path.to_string(),
        start_line: Some(start_line),
        end_line: Some(end_line),
        added,
        removed,
        content: final_output,
    })
}

fn generate_unified_diff(before: &[&str], after: &[&str], path: &str) -> (usize, usize, String) {
    let mut output = String::new();
    output.push_str(&format!("--- {}\n", path));
    output.push_str(&format!("+++ {}\n", path));

    let mut added = 0;
    let mut removed = 0;

    // Build LCS table via dynamic programming.
    let m = before.len();
    let n = after.len();
    let mut dp = vec![vec![0usize; n + 1]; m + 1];
    for i in 1..=m {
        for j in 1..=n {
            if before[i - 1] == after[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }

    // Backtrack to produce the edit sequence (marker, line).
    let mut edits: Vec<(char, &str)> = Vec::new();
    let (mut i, mut j) = (m, n);
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && before[i - 1] == after[j - 1] {
            edits.push((' ', before[i - 1]));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            edits.push(('+', after[j - 1]));
            j -= 1;
        } else {
            edits.push(('-', before[i - 1]));
            i -= 1;
        }
    }
    edits.reverse();

    // Determine which lines to show: changed lines + CONTEXT lines around them.
    const CONTEXT: usize = 3;
    let total = edits.len();
    let mut show = vec![false; total];
    for (idx, (marker, _)) in edits.iter().enumerate() {
        if *marker != ' ' {
            let start = idx.saturating_sub(CONTEXT);
            let end = (idx + CONTEXT + 1).min(total);
            show[start..end].fill(true);
        }
    }

    // Emit output, inserting a separator when skipping unchanged lines.
    let mut prev_shown = false;
    for (idx, (marker, line)) in edits.iter().enumerate() {
        if show[idx] {
            if !prev_shown && idx > 0 {
                output.push_str("...\n");
            }
            match marker {
                '+' => {
                    output.push_str(&format!("+ {}\n", line));
                    added += 1;
                }
                '-' => {
                    output.push_str(&format!("- {}\n", line));
                    removed += 1;
                }
                _ => {
                    output.push_str(&format!("  {}\n", line));
                }
            }
            prev_shown = true;
        } else {
            prev_shown = false;
        }
    }

    (removed, added, output)
}

fn format_result(result: &FileResult) -> String {
    let mut location = if let (Some(start), Some(end)) = (result.start_line, result.end_line) {
        if start == end {
            format!("{}:{}", result.path, start)
        } else {
            format!("{}:{}-{}", result.path, start, end)
        }
    } else {
        result.path.clone()
    };

    // Add diff stats badges if there are changes
    if result.removed > 0 || result.added > 0 {
        location.push_str(&format!(" +{} -{}", result.added, result.removed));
    }

    format!("[{}]\n{}", location, result.content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::tools::{ToolContext, ToolResult};

    /// Fresh workspace dir + a ToolContext rooted at it.
    fn ws(tag: &str) -> (std::path::PathBuf, ToolContext) {
        let dir = std::env::temp_dir().join(format!("mc-file-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let ctx = ToolContext {
            workspace_root: dir.clone(),
            workspace_roots: vec![dir.clone()],
            model_name: String::new(),
            vision_model: String::new(),
            history_len: 0,
            show_tools: false,
            debug: false,
            graph_json: String::new(),
        };
        (dir, ctx)
    }

    fn json(v: serde_json::Value) -> String {
        v.to_string()
    }

    #[test]
    fn image_helpers_classify_by_extension() {
        assert!(is_image_path("a/b/pic.PNG"));
        assert!(!is_image_path("src/main.rs"));
        assert_eq!(image_mime("x.jpeg"), "image/jpeg");
        assert_eq!(image_mime("x.svg"), "image/svg+xml");
        assert_eq!(image_mime("x.unknown"), "image/png");
    }

    #[test]
    fn write_then_read_roundtrip() {
        let (dir, ctx) = ws("rw");
        let w = run(
            &json(serde_json::json!({"action":"write","path":"f.txt","content":"a\nb\nc"})),
            &ctx,
        )
        .unwrap();
        assert!(w.content.contains("created file"));

        let r = run(
            &json(serde_json::json!({"action":"read","path":"f.txt"})),
            &ctx,
        )
        .unwrap();
        assert!(r.content.contains("a") && r.content.contains("c"));
        assert!(r.content.contains("[f.txt]")); // full-file read = no line suffix

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_honors_start_line_and_limit() {
        let (dir, ctx) = ws("slice");
        fs::write(dir.join("f.txt"), "l1\nl2\nl3\nl4\nl5").unwrap();
        let r = run(
            &json(serde_json::json!({"action":"read","path":"f.txt","start_line":2,"limit":2})),
            &ctx,
        )
        .unwrap();
        assert!(r.content.contains("l2") && r.content.contains("l3"));
        assert!(!r.content.contains("l5"));
        assert!(r.content.contains("[showing lines 2-3 of 5]"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_directory_lists_entries() {
        let (dir, ctx) = ws("dir");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.txt"), "x").unwrap();
        let r = run(&json(serde_json::json!({"action":"read","path":"."})), &ctx).unwrap();
        assert!(r.content.contains("directory listing"));
        assert!(r.content.contains("sub/") && r.content.contains("a.txt"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_image_is_rejected_with_guidance() {
        let (dir, ctx) = ws("img");
        fs::write(dir.join("p.png"), "fake").unwrap();
        let err = run(
            &json(serde_json::json!({"action":"read","path":"p.png"})),
            &ctx,
        )
        .unwrap_err();
        assert!(err.contains("vision"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn edit_replaces_single_occurrence() {
        let (dir, ctx) = ws("edit1");
        fs::write(dir.join("f.txt"), "hello world\nbye world").unwrap();
        run(&json(serde_json::json!({"action":"edit","path":"f.txt","old_string":"hello","new_string":"hi"})), &ctx).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("f.txt")).unwrap(),
            "hi world\nbye world"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn edit_ambiguous_match_errors_without_replace_all() {
        let (dir, ctx) = ws("edit2");
        fs::write(dir.join("f.txt"), "x\nx\nx").unwrap();
        let err = run(&json(serde_json::json!({"action":"edit","path":"f.txt","old_string":"x","new_string":"y"})), &ctx).unwrap_err();
        assert!(err.contains("appears 3 times"));
        // replace_all succeeds.
        run(&json(serde_json::json!({"action":"edit","path":"f.txt","old_string":"x","new_string":"y","replace_all":true})), &ctx).unwrap();
        assert_eq!(fs::read_to_string(dir.join("f.txt")).unwrap(), "y\ny\ny");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn edit_rejects_missing_and_identical_strings() {
        let (dir, ctx) = ws("edit3");
        fs::write(dir.join("f.txt"), "content").unwrap();
        // old_string not present.
        let err = run(&json(serde_json::json!({"action":"edit","path":"f.txt","old_string":"nope","new_string":"y"})), &ctx).unwrap_err();
        assert!(err.contains("not found"));
        // identical strings.
        let err = run(&json(serde_json::json!({"action":"edit","path":"f.txt","old_string":"a","new_string":"a"})), &ctx).unwrap_err();
        assert!(err.contains("identical"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn run_rejects_unknown_action() {
        let (dir, ctx) = ws("act");
        let err = run(
            &json(serde_json::json!({"action":"frobnicate","path":"f.txt"})),
            &ctx,
        )
        .unwrap_err();
        assert!(err.contains("unknown action"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unified_diff_marks_added_and_removed() {
        let before = vec!["a", "b", "c"];
        let after = vec!["a", "B", "c"];
        let (removed, added, out) = generate_unified_diff(&before, &after, "f.txt");
        assert_eq!((removed, added), (1, 1));
        assert!(out.contains("- b") && out.contains("+ B"));
        let _: ToolResult = ToolResult { content: out }; // type sanity
    }
}
