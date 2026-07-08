//! The `vision` tool: lets the (possibly text-only) chat model "see" an image
//! by delegating to the Vision-role model. Reads the image bytes, base64s them,
//! and asks the vision model to describe it — the chat model gets back plain
//! text, keeping it as the orchestrator (approach B).

use super::{ToolContext, ToolResult};
use base64::Engine;

pub fn run(arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let path = super::get_string_field(arguments, "path")
        .ok_or_else(|| "vision tool: missing `path`".to_string())?;
    if !super::file::is_image_path(&path) {
        return Err(format!(
            "vision tool: `{path}` is not an image — use the `file` tool for text files"
        ));
    }

    let vision_model = if context.vision_model.is_empty() {
        crate::backend::config::vision_model().ok_or_else(|| {
            "no Vision model assigned — the user must pick one in the model selector".to_string()
        })?
    } else {
        context.vision_model.clone()
    };

    let prompt = super::get_string_field(arguments, "prompt")
        .unwrap_or_else(|| "Describe this image in detail.".to_string());

    let full_path = context.resolve_path(&path);
    let bytes = std::fs::read(&full_path)
        .map_err(|e| format!("vision tool: failed to read {path}: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let mime = super::file::image_mime(&path);

    let provider = crate::backend::llm::provider_for_model(&vision_model);
    let desc = provider.describe_image(&vision_model, &b64, mime, &prompt, context.debug)?;
    Ok(ToolResult { content: desc })
}
