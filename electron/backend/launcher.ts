import { spawn } from "child_process";
import { EnvironmentConfig, WeGameStatus } from "./types";
import { expandPath, getPrefixPath } from "./environment";
import { scanProtonVersions, getDefaultProtonPath } from "./proton";
import path from "path";
import fs from "fs";
import { launcherLogger as log } from "./logger";

let wegameProcessPid: number | null = null;
let wegameStartTime: string | null = null;

export async function launchWegame(
  config: EnvironmentConfig
): Promise<WeGameStatus> {
  const prefixPath = getPrefixPath(config);

  let wegameExe: string;
  if (config.wegame_install_path) {
    wegameExe = path.join(
      expandPath(config.wegame_install_path),
      "WeGameLauncher.exe"
    );
  } else {
    wegameExe = path.join(
      prefixPath,
      "drive_c/Program Files/Tencent/WeGame/WeGameLauncher.exe"
    );
  }

  if (!fs.existsSync(wegameExe)) {
    // Try alternative paths
    const altPaths = [
      path.join(
        prefixPath,
        "drive_c/Program Files (x86)/Tencent/WeGame/WeGameLauncher.exe"
      ),
      path.join(
        prefixPath,
        "drive_c/Program Files/Tencent/WeGame/WeGame.exe"
      ),
    ];
    const found = altPaths.find((p) => fs.existsSync(p));
    if (found) {
      wegameExe = found;
    } else {
      throw new Error(
        `WeGame executable not found. Please install WeGame first.\nSearched in: ${wegameExe}`
      );
    }
  }

  log.info(`WeGame executable resolved: ${wegameExe}`);
  return doLaunch(wegameExe, config);
}

async function doLaunch(
  wegameExe: string,
  config: EnvironmentConfig
): Promise<WeGameStatus> {
  log.separator();
  log.info("=== WeGame Launch Start ===");
  log.info(`WeGame exe: ${wegameExe}`);
  log.info(`Config: ${JSON.stringify(config, null, 2)}`);

  let protonPath: string;
  if (config.proton_path) {
    protonPath = expandPath(config.proton_path);
    log.info(`Using user-specified Proton: ${protonPath}`);
  } else {
    const versions = scanProtonVersions();
    log.info(`Scanned Proton versions: ${versions.map(v => v.name).join(", ") || "(none)"}`);
    const defaultPath = getDefaultProtonPath(versions);
    if (!defaultPath) {
      log.error("No Proton version found!");
      throw new Error(
        "No Proton version found. Install GE-Proton first."
      );
    }
    protonPath = defaultPath;
    log.info(`Auto-selected Proton: ${protonPath}`);
  }

  const prefixPath = getPrefixPath(config);
  const prefixParent = path.dirname(prefixPath);

  // Build environment variables
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    WINEPREFIX: prefixPath,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: prefixPath,
    STEAM_COMPAT_DATA_PATH: prefixParent,
    STEAM_RUNTIME_LIBRARY_PATH: "",
    PROTON_LOG: "",
    DISPLAY: ":0",
    SDL_VIDEO_DONT_ALLOW_VULCAN: "1",
  };

  // Merge extra env vars from config
  for (const [k, v] of Object.entries(config.extra_env_vars)) {
    env[k] = v;
  }

  const args = ["run", wegameExe];
  if (config.launch_args) {
    args.push(config.launch_args);
  }

  log.info(`Spawn command: ${protonPath} ${args.join(" ")}`);
  log.info(`Working directory: ${path.dirname(wegameExe)}`);
  log.info(`Environment variables: WINEPREFIX=${env.WINEPREFIX}, STEAM_COMPAT_DATA_PATH=${env.STEAM_COMPAT_DATA_PATH}`);

  const child = spawn(protonPath, args, {
    cwd: path.dirname(wegameExe),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  wegameProcessPid = child.pid ?? null;
  wegameStartTime = new Date().toISOString().replace("T", " ").slice(0, 19);

  log.info(`Process spawned with PID: ${wegameProcessPid}`);

  // Capture stdout/stderr to log file
  child.stdout?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      const trimmed = line.trim();
      if (trimmed) log.info(`[stdout] ${trimmed}`);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      const trimmed = line.trim();
      if (trimmed) log.warn(`[stderr] ${trimmed}`);
    }
  });

  child.on("close", (code) => {
    log.info(`WeGame process exited with code: ${code}`);
    wegameProcessPid = null;
    wegameStartTime = null;
  });

  child.on("error", (err) => {
    log.error(`WeGame process error: ${err.message}`);
  });

  // Don't wait for the child to exit
  child.unref();

  return {
    running: true,
    pid: wegameProcessPid ?? undefined,
    start_time: wegameStartTime ?? undefined,
    uptime_seconds: 0,
  };
}

export async function stopWegame(): Promise<WeGameStatus> {
  if (wegameProcessPid) {
    try {
      // Kill the process tree
      spawn("kill", ["-TERM", wegameProcessPid.toString()]);

      // Also kill any remaining WeGame-related processes
      spawn("pkill", ["-f", "WeGame"]);

      // Wait then force kill
      await new Promise((resolve) => setTimeout(resolve, 2000));
      spawn("kill", ["-9", wegameProcessPid.toString()]);
    } catch {
      // ignore
    }

    wegameProcessPid = null;
    wegameStartTime = null;
  }

  return {
    running: false,
    pid: undefined,
    start_time: undefined,
    uptime_seconds: undefined,
  };
}

export function checkWegameStatus(): WeGameStatus {
  if (!wegameProcessPid) {
    return { running: false };
  }

  try {
    // Check if process is still alive (signal 0 doesn't kill, just checks)
    process.kill(wegameProcessPid, 0);
    return {
      running: true,
      pid: wegameProcessPid,
      start_time: wegameStartTime ?? undefined,
      uptime_seconds: undefined,
    };
  } catch {
    // Process no longer exists
    wegameProcessPid = null;
    wegameStartTime = null;
    return { running: false };
  }
}
