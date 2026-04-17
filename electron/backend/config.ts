import fs from "fs";
import path from "path";
import { EnvironmentConfig, getDefaultConfig } from "./types";

const CONFIG_FILE_NAME = "config.json";
const DEFAULT_CONFIG_DIR = "decky-wegame/config";

function getConfigDir(): string {
  const dataDir =
    process.env.XDG_DATA_HOME ||
    path.join(process.env.HOME || "/home/deck", ".local/share");
  return path.join(dataDir, DEFAULT_CONFIG_DIR);
}

function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

export function loadConfig(): EnvironmentConfig {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(content) as EnvironmentConfig;
    } catch {
      return getDefaultConfig();
    }
  }
  return getDefaultConfig();
}

export function saveConfig(config: EnvironmentConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}
