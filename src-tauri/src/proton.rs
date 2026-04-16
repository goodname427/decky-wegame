use crate::environment::expand_path;
use crate::types::ProtonInfo;
use anyhow::{Context, Result};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;

const PROTON_SEARCH_PATHS: &[&str] = &[
    "~/.steam/root/compatibilitytools.d/",
    "~/.local/share/Steam/compatibilitytools.d/",
    "/usr/share/steam/compatibilitytools.d/",
];

pub fn scan_proton_versions() -> Result<Vec<ProtonInfo>> {
    let mut versions: Vec<ProtonInfo> = Vec::new();

    for base_path_str in PROTON_SEARCH_PATHS {
        let base_path = expand_path(base_path_str);
        if !base_path.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&base_path) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }

                let dir_name = entry
                    .file_name()
                    .to_string_lossy()
                    .to_string();
                let proton_file = entry.path().join("proton");

                if proton_file.exists() && has_exec_permission(&proton_file) {
                    let version = extract_proton_version(&dir_name);
                    let is_recommended = is_ge_proton(&dir_name);

                    versions.push(ProtonInfo {
                        name: dir_name,
                        version,
                        path: proton_file.to_string_lossy().to_string(),
                        is_recommended,
                    });
                }
            }
        }
    }

    // Sort: recommended first, then by version descending
    versions.sort_by(|a, b| {
        match (a.is_recommended, b.is_recommended) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.version.cmp(&a.version),
        }
    });

    Ok(versions)
}

fn extract_proton_version(name: &str) -> String {
    // Try to extract version number from name like "GE-Proton9-3"
    let cleaned = name
        .replace("GE-Proton", "")
        .replace("Proton-", "")
        .replace("-", ".")
        .trim()
        .to_string();
    if cleaned.is_empty() || !cleaned.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        return name.to_string();
    }
    cleaned
}

fn is_ge_proton(name: &str) -> bool {
    name.to_lowercase().starts_with("ge-proton")
}

fn has_exec_permission(path: &PathBuf) -> bool {
    fs::metadata(path)
        .ok()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

pub fn get_default_proton_path(versions: &[ProtonInfo]) -> Option<String> {
    versions
        .iter()
        .find(|v| v.is_recommended)
        .or_else(|| versions.first())
        .map(|v| v.path.clone())
}

pub fn validate_proton_path(path: &str) -> Result<bool> {
    let expanded = expand_path(path);
    if !expanded.exists() {
        return Ok(false);
    }

    let output = Command::new(&expanded)
        .arg("--version")
        .output()
        .context("Failed to execute Proton binary")?;

    Ok(output.status.success())
}

pub fn check_winetricks_available() -> bool {
    Command::new("which").arg("winetricks").output().is_ok_and(|o| o.status.success())
}
