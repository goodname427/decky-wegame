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
export const startInstallDependencies = (config: any, selectedIds: string[]) =>
  invoke("start_install_dependencies", { config, selectedIds });

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

// Update check
export const checkForUpdate = (channel: string) =>
  invoke("check_for_update", { channel });
export const downloadAndInstallUpdate = (downloadUrl: string, fileName: string) =>
  invoke("download_and_install_update", { downloadUrl, fileName });
