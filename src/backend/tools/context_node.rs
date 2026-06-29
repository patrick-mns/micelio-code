use super::{ToolContext, ToolResult};

pub fn run(arguments: &str, _context: &ToolContext) -> Result<ToolResult, String> {
    let label = super::get_string_field(arguments, "label")
        .ok_or_else(|| "tool call missing `label`".to_string())?;
    let description = super::get_string_field(arguments, "description").unwrap_or_default();
    Ok(ToolResult {
        content: if description.is_empty() {
            format!("context node `{label}` registered")
        } else {
            format!("context node `{label}` registered: {description}")
        },
    })
}
