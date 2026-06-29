use crate::backend::updater::{UpdateStatus, Updater, APP_VERSION};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Check for updates. This is intended to run as a background task.
#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    state: State<'_, Arc<Updater>>,
) -> Result<UpdateStatus, String> {
    // Only check if Idle or Error state
    let cur = state.status.lock().unwrap().clone();
    if matches!(
        cur,
        UpdateStatus::Checking | UpdateStatus::Downloading { .. }
    ) {
        return Ok(cur);
    }

    *state.status.lock().unwrap() = UpdateStatus::Checking;
    let _ = app.emit("update_status", UpdateStatus::Checking);

    let handle = app.clone();
    let updater_state = state.inner().clone();

    let res = tokio::task::spawn_blocking(move || match Updater::check(&handle, &updater_state) {
        Ok(has_update) => {
            let status = updater_state.status.lock().unwrap().clone();
            if !has_update {
                *updater_state.status.lock().unwrap() = UpdateStatus::Idle;
                let _ = handle.emit("update_status", UpdateStatus::Idle);
            }
            status
        }
        Err(e) => {
            *updater_state.status.lock().unwrap() = UpdateStatus::Error(e.clone());
            let _ = handle.emit("update_status", UpdateStatus::Error(e.clone()));
            UpdateStatus::Error(e)
        }
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?;

    Ok(res)
}

/// Retrieve the current update state.
#[tauri::command]
pub async fn get_update_status(state: State<'_, Arc<Updater>>) -> Result<UpdateStatus, String> {
    Ok(state.status.lock().unwrap().clone())
}

/// Retrieve the compiled-in version of the application.
#[tauri::command]
pub async fn get_app_version() -> Result<String, String> {
    Ok(APP_VERSION.to_string())
}

/// Download the update asset.
#[tauri::command]
pub async fn start_update_download(
    app: AppHandle,
    state: State<'_, Arc<Updater>>,
) -> Result<(), String> {
    let updater_state = state.inner().clone();
    let handle = app.clone();

    tokio::task::spawn_blocking(move || {
        if let Err(e) = Updater::download(&handle, &updater_state) {
            *updater_state.status.lock().unwrap() = UpdateStatus::Error(e.clone());
            let _ = handle.emit("update_status", UpdateStatus::Error(e));
        }
    });

    Ok(())
}

/// Install the update and restart the application.
/// On macOS/Linux, it opens the downloaded package (DMG/AppImage/deb). On Windows it runs the setup.
/// In a real system you'd call tauri process-exit/restart or OS openers.
#[tauri::command]
pub async fn install_and_restart(
    app: AppHandle,
    state: State<'_, Arc<Updater>>,
) -> Result<(), String> {
    let status = state.status.lock().unwrap().clone();
    let file_path = match status {
        UpdateStatus::Ready { file_path, .. } => file_path,
        _ => return Err("No downloaded update is ready to install".to_string()),
    };

    // Spawn the OS opener on the downloaded file (e.g. open DMG, run EXE setup, etc.)
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open package: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to run setup: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open packge: {e}"))?;
    }

    // Terminate current process so the installer/user can take over
    app.exit(0);
    Ok(())
}
