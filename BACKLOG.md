# Backlog

## 🚧 Blocked — needs preparation first

| Item | Why blocked | Ref |
|------|-------------|-----|
| **AppState refactor** (session/graph fields) | Risk of real deadlock from nested locking patterns. Must refactor lock sites and add integration tests before grouping. | `sessions.rs:195-202` |
| **History unification** (memory vs DB) | Chat loop has 3 representations (`Vec` in streaming worker, `session_histories` in RAM, `history_json` in SQLite), synced at end-of-turn. Touching without integration tests risks context loss/corruption. | `agent.rs:147` |

---

## 🟡 Deferred — low priority / optional

| Item | Notes |
|------|-------|
| **`commands/` tests** | Requires `AppState` mock setup (~3–4 h). |
| **`ollama.rs` / `openrouter.rs` tests** | Requires HTTP mock; high cost relative to benefit. |
| **Replace raw `unsafe` FFI with `nix` crate** | `terminal.rs` / `bg.rs` (`setsid`, `close`, `kill`) — cosmetic only, same syscalls underneath. |