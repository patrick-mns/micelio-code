//! Typed backend error, introduced incrementally (see plan/002).
//!
//! Modules migrate from `Result<_, String>` to [`BackendResult`] one at a
//! time. The `#[from]` conversions turn the boilerplate
//! `.map_err(|e| format!("…: {e}"))?` into a bare `?`. Call sites that still
//! return `Result<_, String>` keep compiling untouched because
//! `String: From<BackendError>` (the `?` operator applies it), so a migration
//! never ripples past the module being converted.

/// One typed error for the backend.
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("http error {status}: {detail}")]
    Http { status: u16, detail: String },

    #[error("{0}")]
    Provider(String),
}

/// Backend result alias. `T` defaults to `()` for the common side-effecting case.
pub type BackendResult<T = ()> = Result<T, BackendError>;

/// Bridge for the many call sites that still return `format!(…).into()`.
impl From<String> for BackendError {
    fn from(s: String) -> Self {
        BackendError::Provider(s)
    }
}

impl From<&str> for BackendError {
    fn from(s: &str) -> Self {
        BackendError::Provider(s.to_string())
    }
}

/// Lets a freshly-migrated `Result<_, BackendError>` still flow through a
/// caller that returns `Result<_, String>` via `?`, so migration stays local.
impl From<BackendError> for String {
    fn from(e: BackendError) -> Self {
        e.to_string()
    }
}

/// Serialize as the flat message so the Tauri command boundary (which requires
/// `Serialize` errors) sees exactly what `Result<_, String>` produced before.
impl serde::Serialize for BackendError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_and_string_conversion_round_trip() {
        let io = BackendError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"));
        assert!(io.to_string().contains("io error"));
        // The From<BackendError> for String bridge keeps the message.
        let s: String = io.into();
        assert!(s.contains("missing"));
    }

    #[test]
    fn question_mark_bridges_to_string_results() {
        fn migrated() -> BackendResult<u8> {
            Err(BackendError::Provider("boom".into()))
        }
        fn legacy() -> Result<u8, String> {
            Ok(migrated()?)
        }
        assert_eq!(legacy().unwrap_err(), "boom");
    }

    #[test]
    fn provider_serializes_to_plain_message() {
        let json = serde_json::to_string(&BackendError::Provider("oops".into())).unwrap();
        assert_eq!(json, "\"oops\"");
    }
}
