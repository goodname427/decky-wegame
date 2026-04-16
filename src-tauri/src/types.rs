use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentConfig {
    #[serde(default = "default_wine_prefix")]
    pub wine_prefix_path: String,
    #[serde(default = "default_proton_path")]
    pub proton_path: String,
    #[serde(default = "default_wegame_install")]
    pub wegame_install_path: String,
    #[serde(default)]
    pub extra_env_vars: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub launch_args: String,
}

fn default_wine_prefix() -> String {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".local/share/decky-wegame/prefix")
        .to_string_lossy()
        .to_string()
}

fn default_proton_path() -> String {
    String::new()
}

fn default_wegame_install() -> String {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".local/share/decky-wegame/prefix/drive_c/Program Files/Tencent/WeGame")
        .to_string_lossy()
        .to_string()
}

impl Default for EnvironmentConfig {
    fn default() -> Self {
        Self {
            wine_prefix_path: default_wine_prefix(),
            proton_path: String::new(),
            wegame_install_path: default_wegame_install(),
            extra_env_vars: std::collections::HashMap::new(),
            launch_args: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtonInfo {
    pub name: String,
    pub version: String,
    pub path: String,
    pub is_recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyCategory {
    Dotnet,
    Vcpp,
    Font,
    Browser,
    System,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyItem {
    pub id: String,
    pub name: String,
    pub category: DependencyCategory,
    pub description: String,
    pub installed: bool,
    pub size_mb: f64,
    pub required: bool,
    pub install_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeGameStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub start_time: Option<String>,
    pub uptime_seconds: Option<u64>,
}

impl Default for WeGameStatus {
    fn default() -> Self {
        Self {
            running: false,
            pid: None,
            start_time: None,
            uptime_seconds: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub current_dependency: String,
    pub current_step: String,
    pub progress_percent: f64,
    pub total_steps: u32,
    pub completed_steps: u32,
    pub status: InstallStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InstallStatus {
    Idle,
    Running,
    Completed,
    Error,
}

impl Default for InstallProgress {
    fn default() -> Self {
        Self {
            current_dependency: String::new(),
            current_step: String::new(),
            progress_percent: 0.0,
            total_steps: 0,
            completed_steps: 0,
            status: InstallStatus::Idle,
            error_message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameEntry {
    pub name: String,
    pub exe_path: String,
    pub working_dir: String,
    pub icon_url: Option<String>,
    pub added_to_steam: bool,
    pub steam_shortcut_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os_version: String,
    pub architecture: String,
    pub total_disk_gb: f64,
    pub free_disk_gb: f64,
    pub proton_versions: Vec<ProtonInfo>,
    pub winetricks_available: bool,
}
