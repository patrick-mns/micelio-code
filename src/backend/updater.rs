use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Emitter;

/// Current app version — read from Cargo.toml at compile time.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// GitHub API URL for the latest release of this repo.
pub const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/patrick-mns/micelio-code/releases/latest";

// ── GitHub API response shapes ────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub struct GithubRelease {
    pub tag_name: String,
    pub name: String,
    pub body: Option<String>,
    pub assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
pub struct GithubAsset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
}

// ── Update state machine ──────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available {
        version: String,
        notes: String,
        download_url: String,
        asset_name: String,
        asset_size: u64,
        checksum_url: Option<String>,
    },
    Downloading {
        progress: u8, // 0-100
        version: String,
        notes: String,
    },
    Ready {
        file_path: String,
        version: String,
        notes: String,
    },
    Error(String),
}

pub struct Updater {
    pub status: Mutex<UpdateStatus>,
}

impl Updater {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(UpdateStatus::Idle),
        }
    }

    /// Parse version from a GitHub tag like `micelio-v0.2.0` → `0.2.0`.
    /// Returns `None` if the tag doesn't match the expected pattern.
    pub fn parse_tag_version(tag: &str) -> Option<String> {
        let tag = tag.strip_prefix("micelio-v")?;
        // Basic semver validation (just numbers and dots)
        if tag.chars().all(|c| c.is_ascii_digit() || c == '.') {
            Some(tag.to_string())
        } else {
            None
        }
    }

    /// Pick the best asset for the current platform.
    /// macOS → `.dmg` or `.app.tar.gz`, Linux → `.AppImage`, Windows → `.exe`.
    pub fn pick_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
        let priority: &[&str] = if cfg!(target_os = "macos") {
            &[".dmg", ".app.tar.gz", ".tar.gz"]
        } else if cfg!(target_os = "linux") {
            &[".AppImage", ".deb", ".rpm"]
        } else if cfg!(target_os = "windows") {
            &[".exe", ".msi"]
        } else {
            return assets.first();
        };
        for suffix in priority {
            if let Some(a) = assets.iter().find(|a| a.name.ends_with(suffix)) {
                return Some(a);
            }
        }
        assets.first()
    }

    /// Check GitHub for a newer release. Returns `true` if an update is available.
    pub fn check(app: &AppHandle, state: &Updater) -> Result<bool, String> {
        // Build a minimal user-agent so GitHub doesn't 403.
        let agent = ureq::AgentBuilder::new()
            .user_agent(&format!("MicelioCode/{}", APP_VERSION))
            .build();

        let resp = agent
            .get(GITHUB_RELEASES_URL)
            .call()
            .map_err(|e| format!("GitHub request failed: {e}"))?;

        if resp.status() != 200 {
            // 401/403/404 when repo is private or rate-limited — silent skip.
            if resp.status() == 401 || resp.status() == 403 || resp.status() == 404 {
                return Ok(false);
            }
            return Err(format!("GitHub returned HTTP {}", resp.status()));
        }

        let release: GithubRelease = resp
            .into_json()
            .map_err(|e| format!("Failed to parse GitHub response: {e}"))?;

        let latest = Self::parse_tag_version(&release.tag_name)
            .ok_or_else(|| format!("Unrecognised tag format: {}", release.tag_name))?;

        // Compare versions (simple semver compare)
        if !is_newer(&latest, APP_VERSION) {
            return Ok(false);
        }

        // Pick the right asset for this platform
        let asset = Self::pick_asset(&release.assets)
            .ok_or_else(|| "No suitable asset found for this platform".to_string())?;

        // Look for a checksums file in the release assets
        let checksum_url = release
            .assets
            .iter()
            .find(|a| {
                a.name == "micelio-checksums.txt"
                    || a.name == "checksums.txt"
                    || a.name == "SHA256SUMS"
            })
            .map(|a| a.browser_download_url.clone());

        let notes = release.body.unwrap_or_default();

        *state.status.lock().unwrap() = UpdateStatus::Available {
            version: latest,
            notes,
            download_url: asset.browser_download_url.clone(),
            asset_name: asset.name.clone(),
            asset_size: asset.size,
            checksum_url,
        };

        // Emit event so the frontend can react
        let _ = app.emit("update_status", state.status.lock().unwrap().clone());

        Ok(true)
    }

    /// Download the update asset, emitting progress events.
    /// After download, attempts SHA256 verification via the checksums file.
    pub fn download(app: &AppHandle, state: &Updater) -> Result<(), String> {
        let status = state.status.lock().unwrap().clone();
        let (download_url, version, notes, checksum_url) = match &status {
            UpdateStatus::Available {
                download_url,
                version,
                notes,
                checksum_url,
                ..
            } => (
                download_url.clone(),
                version.clone(),
                notes.clone(),
                checksum_url.clone(),
            ),
            other => return Err(format!("Cannot download in state {other:?}")),
        };

        // Set Downloading state
        *state.status.lock().unwrap() = UpdateStatus::Downloading {
            progress: 0,
            version: version.clone(),
            notes: notes.clone(),
        };

        // Stream download with ureq
        let agent = ureq::AgentBuilder::new()
            .user_agent(&format!("MicelioCode/{}", APP_VERSION))
            .build();

        let resp = agent
            .get(&download_url)
            .call()
            .map_err(|e| format!("Download request failed: {e}"))?;

        let total = resp
            .header("Content-Length")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        // Download to a temp file
        let temp_dir = std::env::temp_dir().join("micelio-update");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp dir: {e}"))?;
        let filename = status_label(&status); // safe fallback name
        let temp_path = temp_dir.join(&filename);
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|e| format!("Failed to create temp file: {e}"))?;

        // Set up SHA256 hasher if we have a checksums file to verify against
        let mut hasher = if checksum_url.is_some() {
            Some(Sha256::new())
        } else {
            None
        };

        let mut downloaded: u64 = 0;
        let mut last_reported: u8 = 0;

        let mut reader = resp.into_reader();
        let mut buf = [0u8; 8192];
        loop {
            let n = std::io::Read::read(&mut reader, &mut buf)
                .map_err(|e| format!("Download read error: {e}"))?;
            if n == 0 {
                break;
            }
            std::io::Write::write_all(&mut file, &buf[..n])
                .map_err(|e| format!("Download write error: {e}"))?;

            // Feed bytes to hasher for checksum verification
            if let Some(ref mut h) = hasher {
                h.update(&buf[..n]);
            }

            downloaded += n as u64;

            if total > 0 {
                let pct = ((downloaded as f64 / total as f64) * 100.0) as u8;
                if pct != last_reported {
                    last_reported = pct;
                    *state.status.lock().unwrap() = UpdateStatus::Downloading {
                        progress: pct,
                        version: version.clone(),
                        notes: notes.clone(),
                    };
                    let _ = app.emit("update_status", state.status.lock().unwrap().clone());
                }
            }
        }

        // ── SHA256 verification ────────────────────────────────────
        if let (Some(cs_url), Some(h)) = (&checksum_url, hasher) {
            let actual_hash = format!("{:x}", h.finalize());

            // Fetch the checksums file from the same release
            let cs_resp = agent
                .get(cs_url)
                .call()
                .map_err(|e| format!("Failed to fetch checksums file: {e}"))?;

            let cs_body = cs_resp
                .into_string()
                .map_err(|e| format!("Failed to read checksums file: {e}"))?;

            // Parse: each line is "<sha256>  <filename>" or "<sha256> *<filename>"
            let expected_hash = cs_body
                .lines()
                .find(|line| {
                    line.ends_with(&filename) || line.ends_with(&format!(" *{}", filename))
                })
                .and_then(|line| line.split_whitespace().next())
                .map(|s| s.to_lowercase());

            match expected_hash {
                Some(ref expected) if expected == &actual_hash => {
                    eprintln!("[updater] SHA256 checksum verified: {actual_hash}");
                }
                Some(expected) => {
                    // Mismatch — remove corrupted file and bail
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(format!(
                        "SHA256 mismatch: expected {expected}, got {actual_hash}"
                    ));
                }
                None => {
                    eprintln!(
                        "[updater] No checksum entry found for {filename} in {cs_url} — skipping verification"
                    );
                }
            }
        } else {
            eprintln!("[updater] No checksums file in release — skipping SHA256 verification");
        }

        let file_path = temp_path.to_string_lossy().to_string();
        *state.status.lock().unwrap() = UpdateStatus::Ready {
            file_path,
            version: version.clone(),
            notes: notes.clone(),
        };
        let _ = app.emit("update_status", state.status.lock().unwrap().clone());

        Ok(())
    }
}

/// Compare two semver strings like "0.2.0" → true if `latest > current`.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse =
        |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse::<u32>().ok()).collect() };
    let lv = parse(latest);
    let cv = parse(current);
    lv > cv
}

/// Human-readable label for the update status (used as fallback filename).
fn status_label(status: &UpdateStatus) -> &str {
    match status {
        UpdateStatus::Available { asset_name, .. } => asset_name,
        UpdateStatus::Downloading { .. } => "micelio-update",
        UpdateStatus::Ready { .. } => "micelio-update",
        _ => "micelio-update",
    }
}
