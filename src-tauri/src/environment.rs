use crate::lib::EnvironmentConfig;
use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tokio::process::Command as AsyncCommand;

pub fn expand_path(path: &str) -> PathBuf {
    let expanded = shellexpand::full(path).unwrap_or_default().to_string();
    if expanded.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            return home.join(&expanded[2..]);
        }
    }
    PathBuf::from(expanded)
}

pub fn get_prefix_path(config: &EnvironmentConfig) -> PathBuf {
    expand_path(&config.wine_prefix_path)
}

pub fn prefix_exists(config: &EnvironmentConfig) -> bool {
    let path = get_prefix_path(config);
    path.exists()
        && path.join("drive_c").exists()
        && path.join("system.reg").exists()
}

pub fn get_prefix_size_mb(config: &EnvironmentConfig) -> Result<f64> {
    let path = get_prefix_path(config);
    if !path.exists() {
        return Ok(0.0);
    }

    let output = Command::new("du")
        .arg("-sm")
        .arg("--exclude=drive_c/users")
        .arg(&path)
        .output()
        .context("Failed to calculate prefix size")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let size_str: Vec<&str> = stdout.split_whitespace().collect();
    let size: f64 = size_str.first().unwrap_or(&"0").parse().unwrap_or(0.0);
    Ok(size)
}

pub async fn create_prefix(config: &EnvironmentConfig) -> Result<String> {
    let prefix_path = get_prefix_path(config);
    if prefix_path.exists() {
        return Ok(format!("Wine Prefix already exists at: {}", prefix_path.display()));
    }

    fs::create_dir_all(&prefix_path)
        .with_context(|| format!("Failed to create directory: {}", prefix_path.display()))?;

    let wine_cmd = find_wine_command()?;
    let mut envs: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    envs.insert("WINEPREFIX", prefix_path.to_str().unwrap_or(""));
    envs.insert("WINEDLLOVERRIDES", "mscoree=n");
    envs.insert("DISPLAY", ":0");

    let status = AsyncCommand::new(&wine_cmd)
        .arg("boot")
        .envs(envs)
        .current_dir(&prefix_path)
        .status()
        .await
        .with_context(|| format!("Failed to run wine boot with {}", wine_cmd))?;

    if status.success() {
        Ok(format!(
            "Wine Prefix created successfully at: {}",
            prefix_path.display()
        ))
    } else {
        Err(anyhow::anyhow!(
            "wine boot failed with exit code: {}",
            status.code().unwrap_or(-1)
        ))
    }
}

pub async fn delete_prefix(config: &EnvironmentConfig) -> Result<String> {
    let prefix_path = get_prefix_path(config);

    if !prefix_path.exists() {
        return Ok("No Wine Prefix found to delete.".to_string());
    }

    fs::remove_dir_all(&prefix_path)
        .with_context(|| format!("Failed to delete prefix at: {}", prefix_path.display()))?;

    Ok(format!(
        "Wine Prefix deleted successfully from: {}",
        prefix_path.display()
    ))
}

fn find_wine_command() -> Result<String> {
    let candidates = ["wine64", "wine"];
    for cmd in candidates {
        if let Ok(output) = Command::new("which").arg(cmd).output() {
            if output.status.success() {
                return Ok(cmd.to_string());
            }
        }
    }
    Err(anyhow::anyhow!("Could not find wine or wine64 in PATH"))
}
