// Bridge layer: abstracts backend communication
// In Electron mode, uses window.electronAPI (exposed via preload)
// Type declarations for ElectronAPI are in src/vite-env.d.ts

function getAPI(): ElectronAPI {
  if (window.electronAPI) {
    return window.electronAPI;
  }
  // Fallback for dev without Electron
  return {
    invoke: async (channel: string, ...args: unknown[]) => {
      console.warn(`[api] invoke "${channel}" called without Electron backend`, args);
      throw new Error(`Backend not available: ${channel}`);
    },
    on: (channel: string) => {
      console.warn(`[api] listen "${channel}" called without Electron backend`);
      return () => {};
    },
  };
}

/**
 * Invoke a backend command via IPC.
 * Replaces Tauri's invoke() function.
 */
export async function invoke<T = any>(
  cmd: string,
  args?: Record<string, any>
): Promise<T> {
  const api = getAPI();
  const result = await api.invoke(cmd, args);
  return result as T;
}

/**
 * Listen for events from the backend.
 * Replaces Tauri's listen() function.
 * Returns an unsubscribe function.
 */
export function listen<T = unknown>(
  event: string,
  handler: (payload: T) => void
): () => void {
  const api = getAPI();
  return api.on(event, (...args: unknown[]) => {
    const payload = args[0] as T;
    handler(payload);
  });
}

// Config
export const getConfig = () => invoke("get_config");
export const saveConfig = (config: any) =>
  invoke("save_config_cmd", { config });

// Environment
export const initEnvironment = (config: any) =>
  invoke("init_environment", { config });
export const resetEnvironment = (config: any) =>
  invoke("reset_environment", { config });
export const getPrefixInfo = (config: any) =>
  invoke("get_prefix_info", { config });

// Proton
export const getProtonVersions = () => invoke("get_proton_versions");
export const validateProtonPath = (path: string) =>
  invoke("validate_proton_path_cmd", { path });

// Dependencies
export const getDependencyList = (config?: any) =>
  invoke("get_dependency_list", config ? { config } : undefined);
export const refreshDependencyList = (config?: any) =>
  invoke("refresh_dependency_list", config ? { config } : undefined);
export const installWinetricks = (password: string) =>
  invoke("install_winetricks", { password });
export const startInstallDependencies = (config: any, selectedIds: string[], sudoPassword?: string) =>
  invoke("start_install_dependencies", { config, selectedIds, sudoPassword });

// Skip dependency installation
export const skipDependencyInstallation = (config: any) =>
  invoke("skip_dependency_installation", { config });

// Log management
export const cleanupLogs = () => invoke("cleanup_logs");

// Launcher
export const launchWegame = (config: any) =>
  invoke("launch_wegame_cmd", { config });
export const stopWegame = () => invoke("stop_wegame_cmd");
export const getWegameStatus = () => invoke("get_wegame_status_cmd");

// Games / Steam
export const scanGames = (config: any) => invoke("scan_games", { config });
export const addGameToSteam = (game: any, config: any) =>
  invoke("add_game_to_steam", { game, config });

// System info
export const getSystemInfo = () => invoke("get_system_info");

// Dependency scanning
export const scanSystemDependencies = () =>
  invoke("scan_system_dependencies");
export const validateDependencyPath = (depId: string, path: string) =>
  invoke("validate_dependency_path", { depId, path });

// Middleware management (Proton / Wine / winetricks)
export const deleteProtonVersion = (path: string) =>
  invoke("delete_proton_version", { path });
export const fetchLatestGeProton = () =>
  invoke("fetch_latest_ge_proton");
export const downloadGeProton = () =>
  invoke("download_ge_proton");
export const installWinetricksUserlocal = () =>
  invoke("install_winetricks_userlocal");

// Update check
export const checkForUpdate = (channel: string) =>
  invoke("check_for_update", { channel });
export const downloadAndInstallUpdate = (downloadUrl: string, fileName: string) =>
  invoke("download_and_install_update", { downloadUrl, fileName });

// WeGame runtime diagnostics (PRD v1.4 §4.7)
export const runWegameDiagnostics = (config?: any) =>
  invoke("run_wegame_diagnostics", config ? { config } : undefined);

// WeGame installer (PRD v1.7 §4.1 step 5)
export const getWegameInstallerInfo = (config?: any) =>
  invoke("get_wegame_installer_info", config ? { config } : undefined);
export const checkWegameInstalled = (config: any) =>
  invoke("check_wegame_installed", { config });
export const downloadWegameInstaller = (config: any) =>
  invoke("download_wegame_installer", { config });
export const runWegameInstaller = (config: any, installerPath: string) =>
  invoke("run_wegame_installer", { config, installerPath });
export const installWegame = (config: any, forceRedownload?: boolean) =>
  invoke("install_wegame", { config, forceRedownload });
export const clearWegameInstallerCache = (config?: any) =>
  invoke("clear_wegame_installer_cache", config ? { config } : undefined);

// v1.8.1: pick a local installer file via native dialog, and install from it.
// Returns { canceled: boolean; filePath?: string } from the picker, and the
// same { success; exePath?; error? } shape as install_wegame from the install.
export const pickWegameInstaller = () =>
  invoke<{ canceled: boolean; filePath?: string }>("pick_wegame_installer");
export const installWegameFromLocal = (config: any, localPath: string) =>
  invoke("install_wegame_from_local", { config, localPath });
