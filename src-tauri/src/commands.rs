use crate::dependencies;
use crate::environment::*;
use crate::launcher::{check_wegame_status, launch_wegame, stop_wegame};
use crate::lib::*;
use crate::proton::*;
use crate::steam::{add_to_steam, generate_desktop_entry, list_wegame_games};
use serde::Serialize;
use tauri::State;
use std::sync::Mutex;

pub struct InstallState {
    pub installing: Mutex<bool>,
}

#[tauri::command]
pub async fn get_config() -> Result<EnvironmentConfig, String> {
    load_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_config_cmd(config: EnvironmentConfig) -> Result<(), String> {
    save_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn init_environment(config: EnvironmentConfig) -> Result<String, String> {
    // Save config first
    if let Err(e) = save_config(&config) {
        return Err(e.to_string());
    }

    let result = create_prefix(&config).await.map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub async fn reset_environment(config: EnvironmentConfig) -> Result<String, String> {
    delete_prefix(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_prefix_info(config: EnvironmentConfig) -> Result<PrefixInfo, String> {
    let exists = prefix_exists(&config);
    let size_mb = get_prefix_size_mb(&config).unwrap_or(0.0);
    let path = get_prefix_path(&config)
        .to_string_lossy()
        .to_string();

    Ok(PrefixInfo { exists, size_mb, path })
}

struct PrefixInfo {
    exists: bool,
    size_mb: f64,
    path: String,
}

#[tauri::command]
pub async fn get_proton_versions() -> Result<Vec<ProtonInfo>, String> {
    scan_proton_versions().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn validate_proton_path_cmd(path: String) -> Result<bool, String> {
    validate_proton_path(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_dependency_list(config: EnvironmentConfig) -> Result<Vec<DependencyItem>, String> {
    let deps = dependencies::get_dependency_list();

    // Check installation status based on Wine Prefix
    if prefix_exists(&config) {
        // For now, mark all as not installed - real check would inspect the prefix
        Ok(deps)
    } else {
        Ok(deps)
    }
}

#[tauri::command]
pub async fn start_install_dependencies(
    app_handle: tauri::AppHandle,
    state: State<'_, InstallState>,
    config: EnvironmentConfig,
    selected_ids: Vec<String>,
) -> Result<(), String> {
    // Prevent concurrent installs
    {
        let guard = state.installing.lock().unwrap();
        if *guard {
            return Err("Installation already in progress".to_string());
        }
    }

    {
        let mut guard = state.installing.lock().unwrap();
        *guard = true;
    }

    let prefix_path = get_prefix_path(&config);

    match install_dependencies(&prefix_path, &selected_ids, app_handle).await {
        Ok(_) => {
            let mut guard = state.installing.lock().unwrap();
            *guard = false;
            Ok(())
        }
        Err(e) => {
            let mut guard = state.installing.lock().unwrap();
            *guard = false;
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn launch_wegame_cmd(config: EnvironmentConfig) -> Result<WeGameStatus, String> {
    launch_wegame(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_wegame_cmd() -> Result<WeGameStatus, String> {
    stop_wegame().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_wegame_status_cmd() -> Result<WeGameStatus, String> {
    Ok(check_wegame_status().await)
}

#[tauri::command]
pub async fn scan_games(config: EnvironmentConfig) -> Result<Vec<GameEntry>, String> {
    Ok(list_wegame_games(&config))
}

#[tauri::command]
pub async fn add_game_to_steam(
    game: GameEntry,
    config: EnvironmentConfig,
) -> Result<String, String> {
    let desktop_path =
        generate_desktop_entry(&game, &config).map_err(|e| e.to_string())?;
    add_to_steam(&game, &desktop_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let os_version = std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("PRETTY_NAME="))
                .map(|l| l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
        })
        .unwrap_or_else(|| "Unknown Linux".to_string());

    let architecture = std::env::consts::ARCH.to_string();

    let (total_disk_gb, free_disk_gb) = get_disk_info();

    let proton_versions = scan_proton_versions().unwrap_or_default();
    let winetricks_available = check_winetricks_available();

    Ok(SystemInfo {
        os_version,
        architecture,
        total_disk_gb,
        free_disk_gb,
        proton_versions,
        winetricks_available,
    })
}

fn get_disk_info() -> (f64, f64) {
    let home = dirs::home_dir().unwrap_or_else(|| "/".into());
    match std::process::Command::new("df")
        .arg("-k")
        .arg("--output=size,avail")
        .arg(&home)
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = stdout.lines().collect();
            if lines.len() >= 2 {
                let parts: Vec<f64> = lines[1]
                    .split_whitespace()
                    .filter_map(|s| s.parse::<f64>().ok())
                    .collect();
                if parts.len() >= 2 {
                    let kb_to_gb = 1024.0 * 1024.0;
                    return (parts[0] / kb_to_gb, parts[1] / kb_to_gb);
                }
            }
        }
        _ => {}
    }
    (0.0, 0.0)
}
