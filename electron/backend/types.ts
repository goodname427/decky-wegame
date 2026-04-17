export interface EnvironmentConfig {
  wine_prefix_path: string;
  proton_path: string;
  wegame_install_path: string;
  extra_env_vars: Record<string, string>;
  launch_args: string;
}

export interface ProtonInfo {
  name: string;
  version: string;
  path: string;
  is_recommended: boolean;
}

export type DependencyCategory =
  | "dotnet"
  | "vcpp"
  | "font"
  | "browser"
  | "system"
  | "other";

export interface DependencyItem {
  id: string;
  name: string;
  category: DependencyCategory;
  description: string;
  installed: boolean;
  size_mb: number;
  required: boolean;
  install_time?: string;
}

export interface WeGameStatus {
  running: boolean;
  pid?: number;
  start_time?: string;
  uptime_seconds?: number;
}

export interface InstallProgress {
  current_dependency: string;
  current_step: string;
  progress_percent: number;
  total_steps: number;
  completed_steps: number;
  status: "idle" | "running" | "completed" | "error";
  error_message?: string;
}

export interface GameEntry {
  name: string;
  exe_path: string;
  working_dir: string;
  icon_url?: string;
  added_to_steam: boolean;
  steam_shortcut_id?: string;
}

export interface SystemInfo {
  os_version: string;
  architecture: string;
  total_disk_gb: number;
  free_disk_gb: number;
  proton_versions: ProtonInfo[];
  winetricks_available: boolean;
}

export interface LogPayload {
  level: string;
  message: string;
  timestamp: string;
}

export const DEFAULT_CONFIG: EnvironmentConfig = {
  wine_prefix_path: "",
  proton_path: "",
  wegame_install_path: "",
  extra_env_vars: {},
  launch_args: "",
};

// Set defaults using home dir at runtime
export function getDefaultConfig(): EnvironmentConfig {
  const home = process.env.HOME || "/home/deck";
  return {
    wine_prefix_path: `${home}/.local/share/decky-wegame/prefix`,
    proton_path: "",
    wegame_install_path: `${home}/.local/share/decky-wegame/prefix/drive_c/Program Files/Tencent/WeGame`,
    extra_env_vars: {},
    launch_args: "",
  };
}
