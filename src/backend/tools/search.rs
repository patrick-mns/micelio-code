use super::{ToolContext, ToolResult};
use crate::backend::cmd::no_window_cmd;

pub fn run(arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    // The schema advertises `pattern`; accept `query` too for robustness.
    let query = super::get_string_field(arguments, "pattern")
        .or_else(|| super::get_string_field(arguments, "query"))
        .ok_or_else(|| "tool call missing `pattern`".to_string())?;

    let mut cmd = no_window_cmd("rg");
    cmd.arg("--line-number")
        .arg("--hidden")
        .arg("--glob")
        .arg("!.git")
        .arg(&query);

    for root in &context.workspace_roots {
        cmd.arg(root);
    }

    let output = cmd.output().map_err(|e| format!("failed to run rg: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let content = if stdout.trim().is_empty() {
        format!("No matches for `{query}`.")
    } else {
        // Cap very large result sets so they don't blow the context window.
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() > 200 {
            let shown = lines[..200].join("\n");
            format!(
                "{shown}\n… +{} more lines (narrow the pattern)",
                lines.len() - 200
            )
        } else {
            stdout.into_owned()
        }
    };

    Ok(ToolResult { content })
}
