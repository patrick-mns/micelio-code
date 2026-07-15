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

    // File explorer / Finder.
    #[cfg(target_os = "macos")]
    openers.push(Opener {
        id: "finder".into(),
        name: "Finder".into(),
        kind: "finder".into(),
    });
    #[cfg(windows)]
    openers.push(Opener {
        id: "finder".into(),
        name: "Explorer".into(),
        kind: "finder".into(),
    });
    #[cfg(target_os = "linux")]
    openers.push(Opener {
        id: "finder".into(),
        name: "File Manager".into(),
        kind: "finder".into(),
    });

    // Editors: check common CLI entry points.
    // On Windows, PATHEXT lets us call "code", "cursor" without .cmd/.exe,
    // but which_exists uses where.exe which resolves them.
    for (id, name, bins) in &[
        ("cursor", "Cursor", &["cursor", "cursor.exe"] as &[&str]),
        ("vscode", "VS Code", &["code", "code.cmd"]),
        ("windsurf", "Windsurf", &["windsurf", "windsurf.exe"]),
        ("zed", "Zed", &["zed", "zed.exe"]),
        ("idea", "IntelliJ IDEA", &["idea", "idea.exe"]),
    ] {
        if bins.iter().any(|b| which_exists(b)) {
            openers.push(Opener {
                id: id.to_string(),
                name: name.to_string(),
                kind: "editor".into(),
            });
        }
    }

    // Terminal apps: platform-specific detection.
    #[cfg(target_os = "macos")]
    {
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
    }
    #[cfg(windows)]
    {
        // Windows Terminal, PowerShell, cmd are basically always available
        openers.push(Opener {
            id: "terminal".into(),
            name: "Terminal".into(),
            kind: "terminal".into(),
        });
        // Detect Windows Terminal (wt.exe)
        if which_exists("wt") {
            openers.push(Opener {
                id: "wt".into(),
                name: "Windows Terminal".into(),
                kind: "terminal".into(),
            });
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Try common terminal emulators
        for (id, name, bins) in &[(
            "terminal",
            "Terminal",
            &["gnome-terminal", "xterm", "x-terminal-emulator"] as &[&str],
        )] {
            if bins.iter().any(|b| which_exists(b)) {
                openers.push(Opener {
                    id: id.to_string(),
                    name: name.to_string(),
                    kind: "terminal".into(),
                });
            }
        }
    }

    Ok(openers)
}

/// Open a URL in the default browser.
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    #[cfg(windows)]
    let status = std::process::Command::new("cmd.exe")
        .args(["/C", "start", "", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("xdg-open").arg(&url).spawn();

    status
        .map(|_| ())
        .map_err(|e| format!("failed to open URL: {e}"))
}

/// Open the workspace directory in the given app.
#[tauri::command]
pub async fn open_in(state: State<'_, AppState>, app: String) -> Result<(), String> {
    let root = state.workspace_root.lock().unwrap().clone();
    let path = root.to_string_lossy().to_string();

    let result = match app.as_str() {
        "finder" => open_finder(&path),
        "terminal" => open_terminal(&path),
        "iterm" if cfg!(target_os = "macos") => std::process::Command::new("open")
            .args(["-a", "iTerm", &path])
            .spawn(),
        "ghostty" if cfg!(target_os = "macos") => std::process::Command::new("open")
            .args(["-a", "Ghostty", &path])
            .spawn(),
        "warp" if cfg!(target_os = "macos") => std::process::Command::new("open")
            .args(["-a", "Warp", &path])
            .spawn(),
        "alacritty" if cfg!(target_os = "macos") => std::process::Command::new("open")
            .args(["-a", "Alacritty", &path])
            .spawn(),
        "wt" if cfg!(windows) => std::process::Command::new("wt").arg(&path).spawn(),
        "vscode" => {
            let bin = if cfg!(windows) { "code.cmd" } else { "code" };
            std::process::Command::new(bin).arg(&path).spawn()
        }
        "cursor" => {
            let bin = if cfg!(windows) {
                "cursor.exe"
            } else {
                "cursor"
            };
            std::process::Command::new(bin).arg(&path).spawn()
        }
        "windsurf" => {
            let bin = if cfg!(windows) {
                "windsurf.exe"
            } else {
                "windsurf"
            };
            std::process::Command::new(bin).arg(&path).spawn()
        }
        "zed" => std::process::Command::new("zed").arg(&path).spawn(),
        "idea" => std::process::Command::new("idea").arg(&path).spawn(),
        other => return Err(format!("unknown opener: {other}")),
    };

    result.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_finder(path: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("open").arg(path).spawn()
}
#[cfg(windows)]
fn open_finder(path: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("explorer").arg(path).spawn()
}
#[cfg(target_os = "linux")]
fn open_finder(path: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("xdg-open").arg(path).spawn()
}

#[cfg(target_os = "macos")]
fn open_terminal(path: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("open")
        .args(["-a", "Terminal", path])
        .spawn()
}
#[cfg(windows)]
fn open_terminal(path: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("cmd.exe")
        .args(["/C", "start", "cmd", path])
        .spawn()
}
#[cfg(target_os = "linux")]
fn open_terminal(path: &str) -> std::io::Result<std::process::Child> {
    std::process::Command::new("x-terminal-emulator")
        .arg(path)
        .spawn()
        .or_else(|_| {
            std::process::Command::new("gnome-terminal")
                .arg(path)
                .spawn()
        })
        .or_else(|_| std::process::Command::new("xterm").arg(path).spawn())
}

fn which_exists(bin: &str) -> bool {
    #[cfg(windows)]
    {
        std::process::Command::new("where.exe")
            .arg(bin)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("which")
            .arg(bin)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
