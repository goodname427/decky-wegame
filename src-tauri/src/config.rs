use crate::types::EnvironmentConfig;
use anyhow::Result;
use std::fs;
use std::path::PathBuf;

const CONFIG_FILE_NAME: &str = "config.json";
const DEFAULT_CONFIG_DIR: &str = "decky-wegame/config";

pub fn get_config_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(DEFAULT_CONFIG_DIR)
}

pub fn get_config_path() -> PathBuf {
    get_config_dir().join(CONFIG_FILE_NAME)
}

pub fn load_config() -> Result<EnvironmentConfig> {
    let path = get_config_path();
    if path.exists() {
        let content = fs::read_to_string(&path)?;
        let config: EnvironmentConfig = serde_json::from_str(&content)?;
        Ok(config)
    } else {
        Ok(EnvironmentConfig::default())
    }
}

pub fn save_config(config: &EnvironmentConfig) -> Result<()> {
    let dir = get_config_dir();
    fs::create_dir_all(&dir)?;

    let path = get_config_path();
    let content = serde_json::to_string_pretty(config)?;
    fs::write(&path, content)?;
    Ok(())
}
