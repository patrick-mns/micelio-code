use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub folders: Vec<PathBuf>,
    pub pinned_model: Option<String>,
}

impl Workspace {
    pub fn new(id: String, name: String, folders: Vec<PathBuf>) -> Self {
        Self {
            id,
            name,
            folders,
            pinned_model: None,
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

/// Cria o workspace padrão baseado no last_workspace que tínhamos anteriormente,
/// facilitando o onboarding de quem já vinha usando o app.
pub fn bootstrap_default_workspace(fallback_folder: &Path) -> Workspace {
    let list = list_workspaces();
    if !list.is_empty() {
        return list[0].clone();
    }

    // Criar um workspace inicial
    let id = format!("ws_{}", uuid_short());
    let name = fallback_folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Default Workspace")
        .to_string();

    let mut folders = Vec::new();
    if fallback_folder.is_dir() {
        folders.push(fallback_folder.to_path_buf());
    }

    let ws = Workspace::new(id, name, folders);
    let _ = ws.save();
    ws
}

fn uuid_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // Simple 8-char hex timestamp + randomish snippet
    format!("{:x}", epoch & 0xFFFFFFFF)
}
