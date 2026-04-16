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

export type DependencyCategory =
  | "dotnet"
  | "vcpp"
  | "font"
  | "browser"
  | "system"
  | "other";

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

export interface AppConfig {
  environment: EnvironmentConfig;
  wegame_status: WeGameStatus;
  dependencies: DependencyItem[];
  games: GameEntry[];
  system_info: SystemInfo;
}
