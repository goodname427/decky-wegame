use crate::environment::{expand_path, get_prefix_path};
use crate::types::EnvironmentConfig;
use crate::types::WeGameStatus;
use anyhow::{Context, Result};
use chrono::Local;
use std::collections::HashMap;
use std::process::{Command, Stdio};
use tokio::sync::Mutex;

static WEGAME_PROCESS: Mutex<Option<u32>> = Mutex::const_new(None);

pub async fn launch_wegame(config: &EnvironmentConfig) -> Result<WeGameStatus> {
    let prefix_path = get_prefix_path(config);

    let wegame_exe = if config.wegame_install_path.is_empty() {
        prefix_path.join("drive_c/Program Files/Tencent/WeGame/WeGameLauncher.exe")
    } else {
        expand_path(&config.wegame_install_path).join("WeGameLauncher.exe")
    };

    if !wegame_exe.exists() {
        // Try alternative paths
        let alt_paths = [
            prefix_path.join("drive_c/Program Files (x86)/Tencent/WeGame/WeGameLauncher.exe"),
            prefix_path.join("drive_c/Program Files/Tencent/WeGame/WeGame.exe"),
        ];
        let found = alt_paths.into_iter().find(|p| p.exists());
        match found {
            Some(p) => return do_launch(&p, config).await,
            None => {
                return Err(anyhow::anyhow!(
                    "WeGame executable not found. Please install WeGame first.\nSearched in: {}",
                    wegame_exe.display()
                ));
            }
        }
    }

    do_launch(&wegame_exe, config).await
}

async fn do_launch(wegame_exe: &std::path::Path, config: &EnvironmentConfig) -> Result<WeGameStatus> {
    let proton_path = if config.proton_path.is_empty() {
        // Auto-detect
        let versions = super::proton::scan_proton_versions()?;
        super::proton::get_default_proton_path(&versions)
            .ok_or_else(|| anyhow::anyhow!("No Proton version found. Install GE-Proton first."))?
    } else {
        expand_path(&config.proton_path).to_string_lossy().to_string()
    };
    
    let proton_dir = std::path::Path::new(&proton_path)
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Invalid Proton path"))?;

    // Build environment variables
    let mut env_map: HashMap<&str, String> = HashMap::new();
    env_map.insert("WINEPREFIX", get_prefix_path(config).to_string_lossy().to_string());
    env_map.insert("STEAM_COMPAT_CLIENT_INSTALL_PATH", get_prefix_path(config).to_string_lossy().to_string());
    env_map.insert("STEAM_COMPAT_DATA_PATH", get_prefix_path(config).parent().unwrap_or(&get_prefix_path(config)).to_string_lossy().to_string());
    env_map.insert("STEAM_RUNTIME_LIBRARY_PATH", "".to_string());
    env_map.insert("PROTON_LOG", "".to_string());
    env_map.insert("DISPLAY", ":0".to_string());
    env_map.insert("SDL_VIDEO_DONT_ALLOW_VULCAN", "1".to_string());

    // Merge extra env vars from config
    for (k, v) in &config.extra_env_vars {
        env_map.insert(k.as_str(), v.clone());
    }

    let wegame_str = wegame_exe.to_string_lossy().to_string();

    let mut cmd = Command::new(&proton_path);
    cmd.arg("run")
        .arg(&wegame_str);
        
    if !config.launch_args.is_empty() {
        cmd.arg(&config.launch_args);
    }

    cmd.envs(env_map.iter().map(|(k, v)| (*k, v.as_str())))
        .current_dir(wegame_exe.parent().unwrap_or(wegame_exe))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = cmd.spawn().context("Failed to start WeGame process")?;
    let pid = child.id();

    // Store PID globally
    {
        let mut guard = WEGAME_PROCESS.lock().await;
        *guard = Some(pid);
    }

    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    
    Ok(WeGameStatus {
        running: true,
        pid: Some(pid),
        start_time: Some(now),
        uptime_seconds: Some(0),
    })
}

pub async fn stop_wegame() -> Result<WeGameStatus> {
    let pid = {
        let guard = WEGAME_PROCESS.lock().await;
        *guard
    };

    match pid {
        Some(pid) => {
            #[cfg(target_os = "linux")]
            {
                // Kill the process tree
                let _ = Command::new("kill")
                    .arg("-TERM")
                    .arg(pid.to_string())
                    .output();

                // Also kill any remaining WeGame-related processes
                let _ = Command::new("pkill")
                    .args(["-f", "WeGame"])
                    .output();
                
                // Wait a moment then force kill if still alive
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                let _ = Command::new("kill")
                    .arg("-9")
                    .arg(pid.to_string())
                    .output();
            }

            {
                let mut guard = WEGAME_PROCESS.lock().await;
                *guard = None;
            }

            Ok(WeGameStatus {
                running: false,
                pid: None,
                start_time: None,
                uptime_seconds: None,
            })
        }
        None => Ok(WeGameStatus::default()),
    }
}

pub async fn check_wegame_status() -> WeGameStatus {
    let pid = {
        let guard = WEGAME_PROCESS.lock().await;
        *guard
    };

    match pid {
        Some(pid) => {
            #[cfg(target_os = "linux")]
            {
                let output = Command::new("kill")
                    .arg("-0")
                    .arg(pid.to_string())
                    .output();

                if output.is_ok_and(|o| o.status.success()) {
                    WeGameStatus {
                        running: true,
                        pid: Some(pid),
                        start_time: None,
                        uptime_seconds: None,
                    }
                } else {
                    let mut guard = WEGAME_PROCESS.lock().await;
                    *guard = None;
                    WeGameStatus::default()
                }
            }
            #[cfg(not(target_os = "linux"))]
            {
                WeGameStatus { running: true, pid: Some(pid), start_time: None, uptime_seconds: None }
            }
        }
        None => WeGameStatus::default(),
    }
}
