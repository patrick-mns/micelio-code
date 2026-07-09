use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub folders: Vec<PathBuf>,
}

impl Workspace {
    pub fn new(id: String, name: String, folders: Vec<PathBuf>) -> Self {
        Self {
            id,
            name,
            folders,
        }
    }

    /// Onde os dados deste workspace em específico ficam armazenados (sessions.db, graph.json, etc)
    pub fn dir(&self) -> PathBuf {
        workspaces_dir().join(&self.id)
    }

    pub fn save(&self) -> std::io::Result<()> {
        let dir = self.dir();
        std::fs::create_dir_all(&dir)?;
        let json_path = dir.join("workspace.json");
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(json_path, content)?;
        Ok(())
    }

    pub fn load(id: &str) -> std::io::Result<Self> {
        let json_path = workspaces_dir().join(id).join("workspace.json");
        let content = std::fs::read_to_string(json_path)?;
        let ws: Workspace = serde_json::from_str(&content)?;
        Ok(ws)
    }
}

pub fn workspaces_dir() -> PathBuf {
    super::config::app_data_dir().join("workspaces")
}

pub fn list_workspaces() -> Vec<Workspace> {
    let dir = workspaces_dir();
    let mut list = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return list;
    };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            if let Some(id) = entry.file_name().to_str() {
                if let Ok(ws) = Workspace::load(id) {
                    list.push(ws);
                }
            }
        }
    }
    list
}

/// Gera um id único para um workspace no formato `ws_<nanos>_<seq>`.
///
/// Combina o timestamp em nanossegundos com um contador atômico incrementado a
/// cada chamada, garantindo unicidade mesmo quando dois workspaces são criados
/// dentro do mesmo instante (o timestamp em ms colidiria).
pub fn generate_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("ws_{nanos:x}_{seq:x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn generate_id_is_unique_and_prefixed() {
        let mut seen = HashSet::new();
        for _ in 0..1000 {
            let id = generate_id();
            assert!(id.starts_with("ws_"), "id should be prefixed: {id}");
            assert!(seen.insert(id.clone()), "duplicate id generated: {id}");
        }
    }

    #[test]
    fn new_sets_fields() {
        let folders = vec![PathBuf::from("/a"), PathBuf::from("/b")];
        let ws = Workspace::new("ws_1".into(), "My Workspace".into(), folders.clone());
        assert_eq!(ws.id, "ws_1");
        assert_eq!(ws.name, "My Workspace");
        assert_eq!(ws.folders, folders);
    }

    #[test]
    fn serde_round_trip() {
        let ws = Workspace::new("ws_1".into(), "Demo".into(), vec![PathBuf::from("/x")]);
        let json = serde_json::to_string(&ws).unwrap();
        let back: Workspace = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, ws.id);
        assert_eq!(back.name, ws.name);
        assert_eq!(back.folders, ws.folders);
    }

    /// Workspaces gravados antes da remoção do campo `pinned_model` ainda
    /// contêm essa chave no `workspace.json`. Como não usamos
    /// `deny_unknown_fields`, o serde deve ignorá-la sem erro.
    #[test]
    fn deserializes_legacy_json_with_pinned_model() {
        let legacy = r#"{
            "id": "ws_legacy",
            "name": "Old",
            "folders": ["/legacy"],
            "pinned_model": "llama3"
        }"#;
        let ws: Workspace = serde_json::from_str(legacy).unwrap();
        assert_eq!(ws.id, "ws_legacy");
        assert_eq!(ws.folders, vec![PathBuf::from("/legacy")]);
    }
}
