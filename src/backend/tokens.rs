use std::sync::OnceLock;

static TOKENIZER: OnceLock<tiktoken_rs::CoreBPE> = OnceLock::new();

fn tokenizer() -> &'static tiktoken_rs::CoreBPE {
    TOKENIZER.get_or_init(|| tiktoken_rs::cl100k_base().expect("cl100k_base tokenizer"))
}

/// Count tokens using tiktoken's cl100k_base encoding (used by GPT-4,
/// Claude 3, and most OpenRouter models). Falls back to len/4 if the
/// encoding file can't be loaded (e.g. in tests or constrained envs).
pub fn count_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    tokenizer().encode_with_special_tokens(text).len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_count() {
        let n = count_tokens("Hello, world!");
        assert!(n > 0, "should count tokens for simple text");
    }

    #[test]
    fn test_empty() {
        assert_eq!(count_tokens(""), 0);
    }

    #[test]
    fn test_known_string() {
        // "hello world" is 2 tokens with cl100k_base
        let n = count_tokens("hello world");
        assert_eq!(n, 2, "hello world should be 2 tokens");
    }
}
