import { IpcMain, BrowserWindow } from "electron";
import { loadConfig, saveConfig } from "./backend/config";
import { createPrefix, deletePrefix, prefixExists, getPrefixSizeMb, getPrefixPath } from "./backend/environment";
import { scanProtonVersions, validateProtonPath, checkWinetricksAvailable, checkWineAvailable } from "./backend/proton";
import { launchWegame, stopWegame, checkWegameStatus } from "./backend/launcher";
import { generateDesktopEntry, addToSteam, listWegameGames } from "./backend/steam";
import {
  getDependencyListAsync,
  installDependencies,
  installWinetricks,
  invalidateDependencyCache,
} from "./backend/dependencies";
import { checkForUpdate, downloadAndInstallUpdate, UpdateChannel } from "./backend/updater";
import { scanAllDependencies, validateDependencyPath } from "./backend/dep-scanner";
import {
  deleteProtonVersion,
  downloadAndInstallGeProton,
  fetchLatestGeProtonInfo,
  installWinetricksUserlocal,
} from "./backend/middleware";
import { EnvironmentConfig, GameEntry } from "./backend/types";
import { cleanupAllLogs } from "./backend/logger";
import { runDiagnostics } from "./backend/diagnostics";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";

let installing = false;

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // Config
  ipcMain.handle("get_config", async () => {
    return loadConfig();
  });

  ipcMain.handle("save_config_cmd", async (_event, args: { config: EnvironmentConfig }) => {
    saveConfig(args.config);
  });

  // Environment
  ipcMain.handle("init_environment", async (_event, args: { config: EnvironmentConfig }) => {
    saveConfig(args.config);
    return await createPrefix(args.config);
  });

  ipcMain.handle("reset_environment", async (_event, args: { config: EnvironmentConfig }) => {
    // PRD v1.5 §4.2.2.3: invalidate cache so the next dep-list query re-reads
    // state from the fresh prefix.
    const prefixPath = getPrefixPath(args.config);
    invalidateDependencyCache(prefixPath);
    return await deletePrefix(args.config);
  });

  ipcMain.handle("get_prefix_info", async (_event, args: { config: EnvironmentConfig }) => {
    const exists = prefixExists(args.config);
    const size_mb = getPrefixSizeMb(args.config);
    const path = getPrefixPath(args.config);
    return { exists, size_mb, path };
  });

  // Proton
  ipcMain.handle("get_proton_versions", async () => {
    return scanProtonVersions();
  });

  ipcMain.handle("validate_proton_path_cmd", async (_event, args: { path: string }) => {
    return validateProtonPath(args.path);
  });

  // Dependencies
  //
  // PRD v1.5 §4.2.2.3: we must use the async+cached variant here.
  // The sync `getDependencyList` is kept exported for legacy callers but
  // never used by the IPC handler — `execSync` on `winetricks list-installed`
  // would block the Electron main-process IPC queue for 2~5s (wine + wineserver
  // cold start), freezing every UI action during that window.
  ipcMain.handle("get_dependency_list", async (_event, args?: { config?: EnvironmentConfig }) => {
    const prefixPath = args?.config ? getPrefixPath(args.config) : undefined;
    return await getDependencyListAsync(prefixPath, args?.config);
  });

  // Force-refresh (bypasses cache) — wired to the "Refresh status" button
  // on the dependency management page.
  ipcMain.handle(
    "refresh_dependency_list",
    async (_event, args?: { config?: EnvironmentConfig }) => {
      const prefixPath = args?.config ? getPrefixPath(args.config) : undefined;
      if (prefixPath) invalidateDependencyCache(prefixPath);
      return await getDependencyListAsync(prefixPath, args?.config, { forceRefresh: true });
    }
  );

  ipcMain.handle("install_winetricks", async (_event, args: { password: string }) => {
    try {
      await installWinetricks(args.password);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle("start_install_dependencies", async (_event, args: { config: EnvironmentConfig; selectedIds: string[]; sudoPassword?: string }) => {
    if (installing) {
      throw new Error("Installation already in progress");
    }
    installing = true;

    const prefixPath = getPrefixPath(args.config);
    const win = getMainWindow();

    try {
      await installDependencies(prefixPath, args.selectedIds, {
        emitProgress: (progress) => {
          win?.webContents.send("install-progress", progress);
        },
        emitLog: (log) => {
          win?.webContents.send("log-event", log);
        },
      }, args.sudoPassword, args.config);
    } finally {
      installing = false;
    }
  });

  // Skip dependency installation
  ipcMain.handle("skip_dependency_installation", async (_event, args: { config: EnvironmentConfig }) => {
    const win = getMainWindow();
    
    // Send completion progress with skip message
    win?.webContents.send("install-progress", {
      current_dependency: "",
      current_step: "已跳过依赖安装",
      progress_percent: 100,
      total_steps: 1,
      completed_steps: 1,
      status: "completed",
      error_message: "用户选择跳过依赖安装。您可以在依赖管理中重新安装这些组件。",
    });

    // Send log entry
    win?.webContents.send("log-event", {
      level: "info",
      message: "用户选择跳过依赖安装。跳过的依赖可以在依赖管理中重新安装。",
      timestamp: new Date().toTimeString().slice(0, 8),
    });

    return { success: true, skipped: true };
  });

  // Log management
  ipcMain.handle("cleanup_logs", async () => {
    try {
      cleanupAllLogs();
      return { success: true, message: "日志文件清理完成" };
    } catch (err) {
      return { success: false, message: `日志清理失败: ${err}` };
    }
  });

  // WeGame runtime diagnostics (PRD v1.4 §4.7)
  ipcMain.handle("run_wegame_diagnostics", async (_event, args?: { config?: EnvironmentConfig }) => {
    try {
      return await runDiagnostics(args?.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        timestamp: new Date().toISOString(),
        results: [
          {
            id: "runner",
            title: "诊断执行",
            status: "fail" as const,
            message: `诊断执行失败：${msg}`,
            elapsedMs: 0,
          },
        ],
        overall: "fail" as const,
      };
    }
  });

  // Launcher
  ipcMain.handle("launch_wegame_cmd", async (_event, args: { config: EnvironmentConfig }) => {
    return await launchWegame(args.config);
  });

  ipcMain.handle("stop_wegame_cmd", async () => {
    return await stopWegame();
  });

  ipcMain.handle("get_wegame_status_cmd", async () => {
    return checkWegameStatus();
  });

  // Games / Steam
  ipcMain.handle("scan_games", async (_event, args: { config: EnvironmentConfig }) => {
    return listWegameGames(args.config);
  });

  ipcMain.handle("add_game_to_steam", async (_event, args: { game: GameEntry; config: EnvironmentConfig }) => {
    const desktopPath = generateDesktopEntry(args.game, args.config);
    return addToSteam(args.game, desktopPath);
  });

  // System info
  ipcMain.handle("get_system_info", async () => {
    const osVersion = getOsVersion();
    const architecture = os.arch();
    const { totalDiskGb, freeDiskGb } = getDiskInfo();
    const protonVersions = scanProtonVersions();
    const winetricksAvailable = checkWinetricksAvailable();
    const wineAvailable = checkWineAvailable();

    return {
      os_version: osVersion,
      architecture,
      total_disk_gb: totalDiskGb,
      free_disk_gb: freeDiskGb,
      proton_versions: protonVersions,
      winetricks_available: winetricksAvailable,
      wine_available: wineAvailable,
    };
  });

  // Dependency scanning
  ipcMain.handle("scan_system_dependencies", async () => {
    return scanAllDependencies();
  });

  ipcMain.handle("validate_dependency_path", async (_event, args: { depId: string; path: string }) => {
    return validateDependencyPath(args.depId, args.path);
  });

  // Middleware management (Proton / winetricks)
  ipcMain.handle("delete_proton_version", async (_event, args: { path: string }) => {
    return deleteProtonVersion(args.path);
  });

  ipcMain.handle("fetch_latest_ge_proton", async () => {
    try {
      const info = await fetchLatestGeProtonInfo();
      return { success: true, ...info };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("download_ge_proton", async () => {
    const win = getMainWindow();
    return await downloadAndInstallGeProton((p) => {
      win?.webContents.send("middleware-download-progress", p);
    });
  });

  ipcMain.handle("install_winetricks_userlocal", async () => {
    return await installWinetricksUserlocal();
  });

  // Update check
  ipcMain.handle("check_for_update", async (_event, args: { channel: string }) => {
    return await checkForUpdate(args.channel as UpdateChannel);
  });

  ipcMain.handle("download_and_install_update", async (_event, args: { downloadUrl: string; fileName: string }) => {
    const win = getMainWindow();
    return await downloadAndInstallUpdate(args.downloadUrl, args.fileName, (progress) => {
      win?.webContents.send("update-download-progress", progress);
    });
  });
}

function getOsVersion(): string {
  try {
    const content = fs.readFileSync("/etc/os-release", "utf-8");
    const match = content.match(/PRETTY_NAME="?([^"\n]+)"?/);
    return match ? match[1] : "Unknown Linux";
  } catch {
    return "Unknown Linux";
  }
}

function getDiskInfo(): { totalDiskGb: number; freeDiskGb: number } {
  try {
    const home = os.homedir();
    const output = execSync(`df -k --output=size,avail "${home}"`, { encoding: "utf-8" });
    const lines = output.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/).map(Number);
      if (parts.length >= 2) {
        const kbToGb = 1024 * 1024;
        return { totalDiskGb: parts[0] / kbToGb, freeDiskGb: parts[1] / kbToGb };
      }
    }
  } catch {
    // ignore
  }
  return { totalDiskGb: 0, freeDiskGb: 0 };
}
