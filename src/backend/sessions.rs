//! Chat session persistence in SQLite (.micelio/sessions.db,
//! one database per workspace).
//!
//! Two layers of truth:
//! - `events`: the UI transcript, appended incrementally per message.
//! - `sessions.history_json`: the exact Ollama message history, rewritten
//!   at the end of each turn so resuming restores the model context
//!   verbatim (including tool calls/results).

use crate::backend::error::{BackendError, BackendResult};
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct SessionStore {
    conn: Connection,
}

/// One row of the per-model usage rollup:
/// (model, prompt_tokens, completion_tokens, cost_usd, turn_count).
pub type ModelUsage = (String, i64, i64, f64, i64);

pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub model: String,
    pub updated_at: String,
    pub event_count: usize,
}

pub struct SessionEvent {
    pub kind: String,
    pub content: String,
    pub title: Option<String>,
}

pub struct UsageRow {
    pub id: i64,
    pub ts: i64,
    pub session_id: String,
    pub session_title: String,
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub cost: f64,
    pub duration_ms: i64,
    // Heavy payloads (request/response/*_raw) are NOT loaded by the list query —
    // they're fetched lazily per row via `usage_raw(id)`. Empty in list results.
    pub request: String,
    pub response: String,
    pub prompt_cost: Option<f64>,
    pub completion_cost: Option<f64>,
    pub request_raw: String,
    pub response_raw: String,
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // coarse ISO-ish stamp without pulling a chrono dependency
    format!("{secs}")
}

/// Maps a model role to its column in `sessions`. Returns `None` for unknown
/// roles so the name can never be interpolated into SQL unchecked.
fn model_column(role: &str) -> Option<&'static str> {
    match role {
        "chat" => Some("model"),
        "summarize" => Some("summarize_model"),
        "vision" => Some("vision_model"),
        _ => None,
    }
}

impl SessionStore {
    pub fn open(path: &Path) -> BackendResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                id           TEXT PRIMARY KEY,
                title        TEXT NOT NULL,
                model        TEXT NOT NULL,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                active_nodes TEXT NOT NULL DEFAULT '[]',
                history_json TEXT NOT NULL DEFAULT '[]',
                deleted_at   TEXT
            );
            CREATE TABLE IF NOT EXISTS events (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                kind       TEXT NOT NULL,
                title      TEXT,
                content    TEXT NOT NULL,
                ts         TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            -- Append-only usage ledger: one row per assistant turn. Decoupled
            -- from `events` so clearing/deleting a chat never loses usage, and
            -- each row pins the exact model used for that turn.
            CREATE TABLE IF NOT EXISTS usage_log (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                ts                TEXT NOT NULL,
                session_id        TEXT NOT NULL DEFAULT '',
                model             TEXT NOT NULL,
                prompt_tokens     INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                cost              REAL NOT NULL DEFAULT 0.0,
                duration_ms       INTEGER NOT NULL DEFAULT 0,
                request           TEXT NOT NULL DEFAULT '',
                response          TEXT NOT NULL DEFAULT '',
                prompt_cost       REAL,
                completion_cost   REAL,
                request_raw       TEXT NOT NULL DEFAULT '',
                response_raw      TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);",
        )?;

        // Migrate older tables in place. ALTER fails if the column already
        // exists, which is fine — ignore those errors. The `sessions.model`
        // column holds the chat model; summarize/vision get their own columns
        // so each role can be pinned per session (empty = fall back to the
        // global default).
        for stmt in [
            "ALTER TABLE usage_log ADD COLUMN prompt_cost REAL",
            "ALTER TABLE usage_log ADD COLUMN completion_cost REAL",
            "ALTER TABLE usage_log ADD COLUMN request_raw TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE usage_log ADD COLUMN response_raw TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE sessions ADD COLUMN summarize_model TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE sessions ADD COLUMN vision_model TEXT NOT NULL DEFAULT ''",
            // Per-session agent mode (chat/auto/review). Empty = unset, so the
            // caller falls back to the global default.
            "ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT ''",
        ] {
            let _ = conn.execute(stmt, []);
        }

        Ok(Self { conn })
    }

    pub fn create_session(&self, title: &str, model: &str) -> BackendResult<String> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let id = format!("{nanos:x}");
        let now = now_iso();
        self.conn
            .execute(
                "INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                rusqlite::params![id, title, model, now],
            )?;
        Ok(id)
    }

    pub fn set_title(&self, session_id: &str, title: &str) -> BackendResult<()> {
        self.conn.execute(
            "UPDATE sessions SET title = ?2 WHERE id = ?1",
            rusqlite::params![session_id, title],
        )?;
        Ok(())
    }

    /// The model pinned to `role` ("chat" | "summarize" | "vision") for this
    /// session, or empty if unset (caller falls back to the global default).
    /// Unknown roles return empty so a bad role can never reach SQL.
    pub fn session_model(&self, session_id: &str, role: &str) -> String {
        let Some(col) = model_column(role) else {
            return String::new();
        };
        self.conn
            .query_row(
                &format!("SELECT {col} FROM sessions WHERE id = ?1"),
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_default()
    }

    /// The agent mode pinned to this session ("chat" | "auto" | "review"), or
    /// empty if unset (caller falls back to the global default).
    pub fn session_mode(&self, session_id: &str) -> String {
        self.conn
            .query_row(
                "SELECT mode FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_default()
    }

    /// Pin an agent mode to this session. Pass empty to unset (fall back to the
    /// global default).
    pub fn set_session_mode(&self, session_id: &str, mode: &str) -> BackendResult<()> {
        self.conn.execute(
            "UPDATE sessions SET mode = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![session_id, mode, now_iso()],
        )?;
        Ok(())
    }

    /// Pin `model` to `role` for this session. Unknown roles are a no-op.
    pub fn set_session_model(
        &self,
        session_id: &str,
        role: &str,
        model: &str,
    ) -> BackendResult<()> {
        let Some(col) = model_column(role) else {
            return Ok(());
        };
        self.conn.execute(
            &format!("UPDATE sessions SET {col} = ?2, updated_at = ?3 WHERE id = ?1"),
            rusqlite::params![session_id, model, now_iso()],
        )?;
        Ok(())
    }

    pub fn event_count(&self, session_id: &str) -> usize {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE session_id = ?1",
                [session_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n as usize)
            .unwrap_or(0)
    }

    pub fn append_event(
        &self,
        session_id: &str,
        kind: &str,
        title: Option<&str>,
        content: &str,
    ) -> BackendResult<()> {
        self.conn.execute(
            "INSERT INTO events (session_id, kind, title, content, ts) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![session_id, kind, title, content, now_iso()],
        )?;
        Ok(())
    }

    /// Append one row to the usage ledger for a completed assistant turn. Stores
    /// rich per-request detail (latency + request/response previews) so the
    /// Usage screen can show it even after the chat transcript is cleared.
    #[allow(clippy::too_many_arguments)]
    pub fn log_usage(
        &self,
        session_id: &str,
        model: &str,
        prompt_tokens: u64,
        completion_tokens: u64,
        cost: f64,
        duration_ms: u64,
        request: &str,
        response: &str,
        prompt_cost: Option<f64>,
        completion_cost: Option<f64>,
        request_raw: &str,
        response_raw: &str,
    ) {
        if model.is_empty() {
            return;
        }
        // Cap previews so the ledger can't bloat the DB on huge turns.
        const CAP: usize = 16_000;
        let clip = |s: &str| s.chars().take(CAP).collect::<String>();
        let _ = self.conn.execute(
            "INSERT INTO usage_log
                (ts, session_id, model, prompt_tokens, completion_tokens, cost, duration_ms,
                 request, response, prompt_cost, completion_cost, request_raw, response_raw)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                now_iso(),
                session_id,
                model,
                prompt_tokens as i64,
                completion_tokens as i64,
                cost,
                duration_ms as i64,
                clip(request),
                clip(response),
                prompt_cost,
                completion_cost,
                clip(request_raw),
                clip(response_raw),
            ],
        );
    }

    pub fn save_history(
        &self,
        session_id: &str,
        history_json: &str,
        active_nodes_json: &str,
    ) -> BackendResult<()> {
        self.conn
            .execute(
                "UPDATE sessions SET history_json = ?2, active_nodes = ?3, updated_at = ?4 WHERE id = ?1",
                rusqlite::params![session_id, history_json, active_nodes_json, now_iso()],
            )?;
        Ok(())
    }

    pub fn list_sessions(&self) -> BackendResult<Vec<SessionMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.title, s.model, s.updated_at,
                        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id)
                 FROM sessions s WHERE s.deleted_at IS NULL ORDER BY s.updated_at DESC LIMIT 30",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SessionMeta {
                id: row.get(0)?,
                title: row.get(1)?,
                model: row.get(2)?,
                updated_at: row.get(3)?,
                event_count: row.get::<_, i64>(4)? as usize,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(BackendError::from)
    }

    pub fn latest_session_id(&self) -> BackendResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT id FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.into()),
            })
    }

    pub fn load_events(&self, session_id: &str) -> BackendResult<Vec<SessionEvent>> {
        let mut stmt = self.conn.prepare(
            "SELECT kind, title, content FROM events WHERE session_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([session_id], |row| {
            Ok(SessionEvent {
                kind: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(BackendError::from)
    }

    pub fn load_history(&self, session_id: &str) -> BackendResult<String> {
        self.conn
            .query_row(
                "SELECT history_json FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .map_err(BackendError::from)
    }

    /// Wipe a session's transcript + stored model history but keep the row.
    pub fn clear_events(&self, session_id: &str) -> BackendResult<()> {
        self.conn
            .execute("DELETE FROM events WHERE session_id = ?1", [session_id])?;
        self.conn.execute(
            "UPDATE sessions SET history_json = '[]', title = 'New session' WHERE id = ?1",
            [session_id],
        )?;
        Ok(())
    }

    /// Soft-deletes a session (hides from UI, preserves usage history).
    pub fn delete_session(&self, session_id: &str) -> BackendResult<()> {
        self.conn.execute(
            "UPDATE sessions SET deleted_at = ?2 WHERE id = ?1",
            rusqlite::params![session_id, now_iso()],
        )?;
        Ok(())
    }

    /// Unix-seconds watermark: usage from events at or before this time is
    /// excluded from the Usage screen (set by "Clear"). 0 = never cleared.
    pub fn usage_cleared_at(&self) -> i64 {
        self.conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'usage_cleared_at'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    }

    /// Mark all usage up to now as cleared (the transcript + per-message costs
    /// are untouched; only the Usage aggregates hide it).
    pub fn clear_usage(&self) -> BackendResult<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES ('usage_cleared_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [now_iso()],
        )?;
        Ok(())
    }

    /// Aggregate token/cost usage per model from assistant events, honoring the
    /// clear watermark and an optional [from, to] Unix-seconds window.
    /// Returns rows of (model, prompt_tokens, completion_tokens, cost, turns).
    pub fn usage_by_model(
        &self,
        from: Option<i64>,
        to: Option<i64>,
    ) -> BackendResult<Vec<ModelUsage>> {
        let cleared = self.usage_cleared_at();
        let from = from.unwrap_or(0).max(cleared);
        let to = to.unwrap_or(i64::MAX);
        let mut stmt = self.conn.prepare(
            "SELECT model,
                    COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0),
                    COALESCE(SUM(cost), 0.0),
                    COUNT(*)
             FROM usage_log
             WHERE CAST(ts AS INTEGER) > ?1
               AND CAST(ts AS INTEGER) <= ?2
             GROUP BY model",
        )?;
        let rows = stmt.query_map(rusqlite::params![from, to], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(BackendError::from)
    }

    /// Individual usage-ledger rows (most recent first), honoring the clear
    /// watermark and an optional [from, to] window. `limit` caps the result.
    /// The session title is empty if the session was since hard-removed;
    /// soft-deleted sessions still resolve.
    pub fn usage_log(
        &self,
        from: Option<i64>,
        to: Option<i64>,
        limit: i64,
    ) -> BackendResult<Vec<UsageRow>> {
        let cleared = self.usage_cleared_at();
        let from = from.unwrap_or(0).max(cleared);
        let to = to.unwrap_or(i64::MAX);
        // Lightweight: the heavy request/response/*_raw blobs (up to 16k chars
        // each, ×4) are deliberately excluded — loading them for every row made
        // the Usage screen slow. They're fetched per-row on demand via usage_raw().
        let mut stmt = self.conn.prepare(
            "SELECT u.id, CAST(u.ts AS INTEGER), u.session_id, COALESCE(s.title, ''),
                    u.model, u.prompt_tokens, u.completion_tokens, u.cost,
                    u.duration_ms, u.prompt_cost, u.completion_cost
             FROM usage_log u
             LEFT JOIN sessions s ON s.id = u.session_id
             WHERE CAST(u.ts AS INTEGER) > ?1 AND CAST(u.ts AS INTEGER) <= ?2
             ORDER BY u.id DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(rusqlite::params![from, to, limit], |row| {
            Ok(UsageRow {
                id: row.get(0)?,
                ts: row.get(1)?,
                session_id: row.get(2)?,
                session_title: row.get(3)?,
                model: row.get(4)?,
                prompt_tokens: row.get(5)?,
                completion_tokens: row.get(6)?,
                cost: row.get(7)?,
                duration_ms: row.get(8)?,
                prompt_cost: row.get(9)?,
                completion_cost: row.get(10)?,
                request: String::new(),
                response: String::new(),
                request_raw: String::new(),
                response_raw: String::new(),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(BackendError::from)
    }

    /// The heavy payloads for a single ledger row, fetched lazily when a row is
    /// opened in the detail panel. Returns (request, response, request_raw,
    /// response_raw).
    pub fn usage_raw(&self, id: i64) -> BackendResult<(String, String, String, String)> {
        self.conn
            .query_row(
                "SELECT request, response, request_raw, response_raw FROM usage_log WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(BackendError::from)
    }

    /// Resolve a session by unique id prefix.
    pub fn resolve_id(&self, prefix: &str) -> BackendResult<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM sessions WHERE id LIKE ?1 || '%' LIMIT 2")?;
        let ids: Vec<String> = stmt
            .query_map([prefix], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(if ids.len() == 1 {
            ids.into_iter().next()
        } else {
            None
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A store of its own per test. Cargo runs tests as threads in one process,
    /// so a path keyed only on the pid is shared by every test in the file —
    /// they'd race on the same database and delete each other's directory.
    fn store(name: &str) -> (std::path::PathBuf, SessionStore) {
        let dir = std::env::temp_dir().join(format!("mc-sessions-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let s = SessionStore::open(&dir.join("sessions.db")).unwrap();
        (dir, s)
    }

    /// Fills in the uninteresting half of `log_usage`'s argument list.
    fn log(s: &SessionStore, session_id: &str, model: &str, prompt: u64, completion: u64) {
        s.log_usage(
            session_id, model, prompt, completion, 0.5, 100, "req", "resp", None, None, "", "",
        );
    }

    #[test]
    fn session_roundtrip() {
        let dir = std::env::temp_dir().join(format!("mc-test-{}", std::process::id()));
        let db = dir.join("sessions.db");
        let store = SessionStore::open(&db).unwrap();

        let id = store.create_session("test chat", "gemma").unwrap();
        store.append_event(&id, "user", None, "hello").unwrap();
        store.append_event(&id, "assistant", None, "hi!").unwrap();
        store
            .save_history(&id, "[{\"role\":\"user\"}]", "[\"a\"]")
            .unwrap();

        let sessions = store.list_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].event_count, 2);

        let events = store.load_events(&id).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "user");

        assert!(store.load_history(&id).unwrap().contains("user"));
        assert_eq!(store.resolve_id(&id[..6]).unwrap(), Some(id.clone()));
        assert_eq!(store.latest_session_id().unwrap(), Some(id.clone()));

        store.delete_session(&id).unwrap();
        assert!(store.list_sessions().unwrap().is_empty()); // soft-deleted, hidden from list
        assert!(!store.load_events(&id).unwrap().is_empty()); // events preserved

        let _ = std::fs::remove_dir_all(dir);
    }

    /// The ledger is a separate table precisely so wiping a transcript doesn't
    /// erase what it cost — billing history shouldn't hinge on whether someone
    /// tidied up a chat.
    #[test]
    fn clearing_a_chat_keeps_its_usage() {
        let (dir, s) = store("clear-events");
        let id = s.create_session("chat", "gemma").unwrap();
        s.append_event(&id, "user", None, "hello").unwrap();
        log(&s, &id, "gemma", 100, 20);

        s.clear_events(&id).unwrap();

        assert_eq!(s.event_count(&id), 0, "transcript wiped");
        assert_eq!(s.load_history(&id).unwrap(), "[]", "model history reset");
        let usage = s.usage_by_model(None, None).unwrap();
        assert_eq!(usage, vec![("gemma".into(), 100, 20, 0.5, 1)], "usage kept");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_a_session_keeps_its_usage() {
        let (dir, s) = store("delete-session");
        let id = s.create_session("chat", "gemma").unwrap();
        log(&s, &id, "gemma", 100, 20);

        s.delete_session(&id).unwrap();

        assert!(
            s.list_sessions().unwrap().is_empty(),
            "hidden from the list"
        );
        let usage = s.usage_by_model(None, None).unwrap();
        assert_eq!(usage, vec![("gemma".into(), 100, 20, 0.5, 1)], "usage kept");
        // Soft delete, so the ledger can still name the session it came from.
        let rows = s.usage_log(None, None, 10).unwrap();
        assert_eq!(rows[0].session_title, "chat");

        let _ = std::fs::remove_dir_all(dir);
    }

    /// `role` picks a column name that gets formatted straight into SQL, so the
    /// whitelist in `model_column` is the only thing between a caller and
    /// injection. Both directions must refuse anything off the list.
    #[test]
    fn an_unknown_model_role_reaches_neither_sql_nor_state() {
        let (dir, s) = store("bad-role");
        let id = s.create_session("chat", "gemma").unwrap();

        for role in [
            "",
            "bogus",
            "model",
            "model = 'x' --",
            "model; DROP TABLE sessions",
        ] {
            assert!(
                s.set_session_model(&id, role, "evil").is_ok(),
                "role {role:?} should be an inert no-op, not an error"
            );
            assert_eq!(s.session_model(&id, role), "", "role {role:?} read back");
        }

        // The table is intact and the real column untouched.
        assert_eq!(s.session_model(&id, "chat"), "gemma");
        assert_eq!(s.list_sessions().unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn each_model_role_is_pinned_separately() {
        let (dir, s) = store("roles");
        let id = s.create_session("chat", "gemma").unwrap();

        s.set_session_model(&id, "summarize", "phi").unwrap();
        s.set_session_model(&id, "vision", "llava").unwrap();

        assert_eq!(s.session_model(&id, "chat"), "gemma", "chat untouched");
        assert_eq!(s.session_model(&id, "summarize"), "phi");
        assert_eq!(s.session_model(&id, "vision"), "llava");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn session_mode_is_empty_until_pinned() {
        let (dir, s) = store("mode");
        let id = s.create_session("chat", "gemma").unwrap();

        // Empty means "unset" — the caller falls back to the global default,
        // so this must not report some invented mode.
        assert_eq!(s.session_mode(&id), "");
        s.set_session_mode(&id, "review").unwrap();
        assert_eq!(s.session_mode(&id), "review");
        s.set_session_mode(&id, "").unwrap();
        assert_eq!(s.session_mode(&id), "", "back to the default");

        assert_eq!(s.session_mode("no-such-session"), "", "unknown id is empty");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn usage_without_a_model_is_dropped() {
        let (dir, s) = store("no-model");
        let id = s.create_session("chat", "gemma").unwrap();

        // A turn that never reached a provider has nothing to attribute cost
        // to; logging it would invent a nameless row in the ledger.
        log(&s, &id, "", 100, 20);
        assert!(s.usage_by_model(None, None).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn clearing_usage_hides_what_came_before() {
        let (dir, s) = store("clear-usage");
        let id = s.create_session("chat", "gemma").unwrap();
        log(&s, &id, "gemma", 100, 20);
        assert_eq!(s.usage_by_model(None, None).unwrap().len(), 1, "premise");

        s.clear_usage().unwrap();

        assert!(s.usage_by_model(None, None).unwrap().is_empty());
        assert!(s.usage_log(None, None, 10).unwrap().is_empty());
        assert!(s.usage_cleared_at() > 0, "watermark recorded");

        let _ = std::fs::remove_dir_all(dir);
    }

    /// Previews are capped by character, not by byte: `s[..CAP]` would panic on
    /// a request that happens to put a multi-byte character on the boundary.
    #[test]
    fn usage_previews_are_capped_without_splitting_characters() {
        let (dir, s) = store("clip");
        let id = s.create_session("chat", "gemma").unwrap();

        let huge = "é".repeat(20_000);
        s.log_usage(
            &id, "gemma", 1, 1, 0.0, 1, &huge, &huge, None, None, &huge, &huge,
        );

        let row_id = s.usage_log(None, None, 1).unwrap()[0].id;
        let (req, resp, req_raw, resp_raw) = s.usage_raw(row_id).unwrap();
        for (what, got) in [
            ("request", &req),
            ("response", &resp),
            ("request_raw", &req_raw),
            ("response_raw", &resp_raw),
        ] {
            assert_eq!(got.chars().count(), 16_000, "{what} capped by chars");
            assert!(
                got.chars().all(|c| c == 'é'),
                "{what} kept whole characters"
            );
        }

        let _ = std::fs::remove_dir_all(dir);
    }
}
