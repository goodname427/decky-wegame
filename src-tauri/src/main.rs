mod commands;
mod config;
mod dependencies;
mod environment;
mod launcher;
mod proton;
mod steam;
mod types;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // Config
            commands::get_config,
            commands::save_config_cmd,
            // Environment
            commands::init_environment,
            commands::reset_environment,
            commands::get_prefix_info,
            // Proton
            commands::get_proton_versions,
            commands::validate_proton_path_cmd,
            // Dependencies
            commands::get_dependency_list,
            commands::start_install_dependencies,
            // Launcher
            commands::launch_wegame_cmd,
            commands::stop_wegame_cmd,
            commands::get_wegame_status_cmd,
            // Steam
            commands::scan_games,
            commands::add_game_to_steam,
            // System
            commands::get_system_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
