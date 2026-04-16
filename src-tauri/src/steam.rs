use crate::environment::expand_path;
use crate::lib::*;
use anyhow::{Context, Result};
use chrono::Local;
use std::fs;
use std::path::PathBuf;

const STEAM_APPS_DIR: &str = "~/.steam/root/steamapps";
const DESKTOP_ENTRY_DIR: &str = "~/.local/share/applications";

fn get_steam_apps_dir() -> PathBuf {
    expand_path(STEAM_APPS_DIR)
}

pub fn generate_desktop_entry(game: &GameEntry, config: &EnvironmentConfig) -> Result<PathBuf> {
    let desktop_dir = expand_path(DESKTOP_ENTRY_DIR);
    fs::create_dir_all(&desktop_dir)?;

    let safe_name = game
        .name
        .replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-', "_");
    let filename = format!("decky-wegame-{}.desktop", safe_name.to_lowercase());
    let path = desktop_dir.join(&filename);

    let proton_path = if config.proton_path.is_empty() {
        "auto".to_string()
    } else {
        config.proton_path.clone()
    };

    let wine_prefix_str = config.wine_prefix_path.clone();
    let exe_path = game.exe_path.clone();
    let working_dir = game.working_dir.clone();

    let content = format!(
        "[Desktop Entry]\n\
         Name={}\n\
         Comment=Launched via WeGame Launcher\n\
         Exec=sh -c \"WINEPREFIX='{}' '{}'\"\n\
         Icon=steam_icon\n\
         Terminal=false\n\
         Type=Application\n\
         Categories=Game;\n\
         StartupWMClass=winegame.exe\n\
         Path={}\n",
        game.name, wine_prefix_str, exe_path, working_dir,
    );

    fs::write(&path, content).with_context(|| format!("Failed to write desktop entry to {}", path.display()))?;

    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&path, perms)?;
    }

    Ok(path)
}

pub fn add_to_steam(game: &GameEntry, desktop_path: &PathBuf) -> Result<String> {
    let shortcut_id = uuid::Uuid::new_v4().to_string();

    // Generate a Steam-compatible shortcut info string that users can use
    // with Steam's "Add Non-Steam Game" feature
    let info = format!(
        "Steam Shortcut Added!\n\
         \n\
         Game: {}\n\
         Desktop File: {}\n\
         \n\
         Next Steps:\n\
         1. Open Steam\n\
         2. Go to Library → + Add Game → Add a Non-Steam Game\n\
         3. Browse and select the desktop file:\n   {}\n\
         4. Right-click the game in Steam → Properties → Compatibility\n\
         5. Check 'Force using Steam Play compatibility tool'\n\
         6. Select your Proton version\n\
         7. Click Play to launch!",
        game.name,
        desktop_path.display(),
        desktop_path.display()
    );

    Ok(info)
}

pub fn list_wegame_games(config: &EnvironmentConfig) -> Vec<GameEntry> {
    let mut games = Vec::new();

    let prefix_path = expand_path(&config.wine_prefix_path);
    let wegame_dir = prefix_path.join("drive_c/Program Files/Tencent");

    if !wegame_dir.exists() {
        return games;
    }

    // Common WeGame game directories to scan
    let scan_paths = [
        wegame_dir.join("WeGame"),
        wegame_dir.join("QQGame"),
        prefix_path.join("drive_c/Program Files (x86)/Tencent"),
    ];

    for scan_path in scan_paths.iter().filter(|p| p.exists()) {
        if let Ok(entries) = fs::read_dir(scan_path) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();

                // Look for .exe files in this directory
                find_exe_in_dir(&entry.path(), &name, &mut games);
            }
        }
    }

    games.sort_by(|a, b| a.name.cmp(&b.name));
    games.dedup_by(|a, b| a.exe_path == b.exe_path);

    games
}

fn find_exe_in_dir(dir: &PathBuf, parent_name: &str, games: &mut Vec<GameEntry>) {
    let exe_names = [
        "*.exe",
        "Game.exe",
        "Launcher.exe",
        "Start.exe",
        "Client.exe",
    ];

    for name in &exe_names {
        let pattern = dir.join(name);
        if *name == "*.exe" {
            // Glob search
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name.ends_with(".exe")
                        && !file_name.to_lowercase().contains("uninstall")
                        && !file_name.to_lowercase().contains("setup")
                    {
                        games.push(GameEntry {
                            name: file_name.replace(".exe", ""),
                            exe_path: entry.path().to_string_lossy().to_string(),
                            working_dir: dir.to_string_lossy().to_string(),
                            icon_url: None,
                            added_to_steam: false,
                            steam_shortcut_id: None,
                        });
                    }
                }
            }
        } else {
            let full_path = dir.join(name);
            if full_path.exists() {
                games.push(GameEntry {
                    name: parent_name.to_string(),
                    exe_path: full_path.to_string_lossy().to_string(),
                    working_dir: dir.to_string_lossy().to_string(),
                    icon_url: None,
                    added_to_steam: false,
                    steam_shortcut_id: None,
                });
                break;
            }
        }
    }
}
