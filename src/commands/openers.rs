use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct Opener {
    pub id: String,
    pub name: String,
    pub kind: String, // "editor" | "terminal" | "finder"
}

/// Detect which apps are available to open the workspace.
#[tauri::command]
pub async fn list_openers() -> Result<Vec<Opener>, String> {
    let mut openers = Vec::new();

    // Finder is always available on macOS.
    openers.push(Opener {
        id: "finder".into(),
        name: "Finder".into(),
        kind: "finder".into(),
    });

    // Editors: check common CLI entry points.
    for (id, name, bins) in &[
        (
            "cursor",
            "Cursor",
            &[
                "cursor",
                "/usr/local/bin/cursor",
                "/opt/homebrew/bin/cursor",
            ] as &[&str],
        ),
        (
            "vscode",
            "VS Code",
            &["code", "/usr/local/bin/code", "/opt/homebrew/bin/code"],
        ),
        (
            "windsurf",
            "Windsurf",
            &["windsurf", "/usr/local/bin/windsurf"],
        ),
        (
            "zed",
            "Zed",
            &["zed", "/usr/local/bin/zed", "/opt/homebrew/bin/zed"],
        ),
        ("idea", "IntelliJ IDEA", &["idea", "/usr/local/bin/idea"]),
    ] {
        let found = bins.iter().any(|b| {
            if b.starts_with('/') {
                std::path::Path::new(b).exists()
            } else {
                which_exists(b)
            }
        });
        if found {
            openers.push(Opener {
                id: id.to_string(),
                name: name.to_string(),
                kind: "editor".into(),
            });
        }
    }

    // Terminal apps.
    for (id, name, app_path) in &[
        ("ghostty", "Ghostty", "/Applications/Ghostty.app"),
        ("iterm", "iTerm", "/Applications/iTerm.app"),
        ("warp", "Warp", "/Applications/Warp.app"),
        ("alacritty", "Alacritty", "/Applications/Alacritty.app"),
        (
            "terminal",
            "Terminal",
            "/System/Applications/Utilities/Terminal.app",
        ),
    ] {
        if std::path::Path::new(app_path).exists() {
            openers.push(Opener {
                id: id.to_string(),
                name: name.to_string(),
                kind: "terminal".into(),
            });
        }
    }

    Ok(openers)
}

/// Open a URL in the default browser (macOS `open` command).
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open URL: {e}"))
}

/// Open the workspace directory in the given app.
#[tauri::command]
pub async fn open_in(state: State<'_, AppState>, app: String) -> Result<(), String> {
    let root = state.workspace_root.lock().unwrap().clone();
    let path = root.to_string_lossy().to_string();

    let result = match app.as_str() {
        "finder" => std::process::Command::new("open").arg(&path).spawn(),
        "terminal" => std::process::Command::new("open")
            .args(["-a", "Terminal", &path])
            .spawn(),
        "iterm" => std::process::Command::new("open")
            .args(["-a", "iTerm", &path])
            .spawn(),
        "ghostty" => std::process::Command::new("open")
            .args(["-a", "Ghostty", &path])
            .spawn(),
        "warp" => std::process::Command::new("open")
            .args(["-a", "Warp", &path])
            .spawn(),
        "alacritty" => std::process::Command::new("open")
            .args(["-a", "Alacritty", &path])
            .spawn(),
        "vscode" => std::process::Command::new("code").arg(&path).spawn(),
        "cursor" => std::process::Command::new("cursor").arg(&path).spawn(),
        "windsurf" => std::process::Command::new("windsurf").arg(&path).spawn(),
        "zed" => std::process::Command::new("zed").arg(&path).spawn(),
        "idea" => std::process::Command::new("idea").arg(&path).spawn(),
        other => return Err(format!("unknown opener: {other}")),
    };

    result.map(|_| ()).map_err(|e| e.to_string())
}

fn which_exists(bin: &str) -> bool {
    std::process::Command::new("which")
        .arg(bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
