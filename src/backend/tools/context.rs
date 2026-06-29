use super::{ToolContext, ToolResult};
use std::fs;

pub fn run(_arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let file_count = count_workspace_files(&context.workspace_root)?;
    let content = format!(
        "model: {}\nworkspace_root: {}\nhistory_messages: {}\nfiles: {}\nshow_tools: {}\ndebug: {}\navailable_tools:\n- context\n- terminal\n- read_file\n- write_file\n- search\n",
        context.model_name,
        context.workspace_root.display(),
        context.history_len,
        file_count,
        context.show_tools,
        context.debug
    );
    Ok(ToolResult { content })
}

fn count_workspace_files(root: &std::path::Path) -> Result<usize, String> {
    let mut count = 0usize;
    walk(root, &mut count)?;
    Ok(count)
}

fn walk(dir: &std::path::Path, count: &mut usize) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("failed to read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == ".git" || file_name == "target" {
            continue;
        }
        if path.is_dir() {
            walk(&path, count)?;
        } else {
            *count += 1;
        }
    }
    Ok(())
}
