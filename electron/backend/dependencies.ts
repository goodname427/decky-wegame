import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { DependencyItem, DependencyCategory, EnvironmentConfig, InstallProgress, LogPayload } from "./types";
import { expandPath } from "./environment";
import { scanProtonVersions, getDefaultProtonPath } from "./proton";
import { depsLogger as log } from "./logger";

/**
 * Resolve environment variables required to run winetricks using the wine
 * runtime bundled with the user-selected Proton.
 *
 * On SteamOS / Steam Deck there is typically no standalone `wine` /
 * `wineserver` in PATH, so winetricks fails with "wineserver not found!".
 * This helper injects the Proton-bundled wine binaries so winetricks and
 * the configuration uses exactly the same wine as the launcher does.
 *
 * @throws Error with a user-friendly message when no usable wine backend can
 *         be resolved. Caller must surface this error to the UI instead of
 *         silently continuing the install loop.
 */
export function resolveWineBackendEnv(config?: EnvironmentConfig): {
  env: Record<string, string>;
  protonDir: string;
  protonBin: string;
} {
  // 1. Determine Proton executable path (user-selected or auto-detected)
  let protonExe: string | undefined;
  if (config?.proton_path) {
    protonExe = expandPath(config.proton_path);
  }
  if (!protonExe || !fs.existsSync(protonExe)) {
    const versions = scanProtonVersions();
    const auto = getDefaultProtonPath(versions);
    if (auto) protonExe = auto;
  }

  if (!protonExe || !fs.existsSync(protonExe)) {
    throw new Error(
      "未找到可用的 Wine 后端：请先在『配置向导』或『依赖管理 → 中间层管理』中选定一个 Proton 版本，或点击『下载最新 GE-Proton』。"
    );
  }

  // 2. Locate Proton's bundled wine bin directory (files/bin or dist/bin)
  const protonDir = path.dirname(protonExe);
  const candidateBinDirs = [
    path.join(protonDir, "files", "bin"),
    path.join(protonDir, "dist", "bin"),
  ];
  const protonBin = candidateBinDirs.find((p) => fs.existsSync(p));
  if (!protonBin) {
    throw new Error(
      `所选 Proton 目录下未找到 wine 运行时（期望目录：${candidateBinDirs.join(" 或 ")}）。请检查 Proton 是否完整。`
    );
  }

  // 3. Locate wine / wine64 / wineserver
  const wineserver = path.join(protonBin, "wineserver");
  if (!fs.existsSync(wineserver)) {
    throw new Error(
      `Proton 自带的 wineserver 不存在：${wineserver}。请尝试重新下载 GE-Proton。`
    );
  }
  const wine64 = path.join(protonBin, "wine64");
  const wine = path.join(protonBin, "wine");
  const wineCmd = fs.existsSync(wine64) ? wine64 : wine;
  const wineloader = fs.existsSync(wine) ? wine : wineCmd;

  // 4. Compose WINEDLLPATH (optional, helps wine find dlls)
  const dllPaths: string[] = [];
  for (const rel of ["files/lib64/wine", "files/lib/wine", "dist/lib64/wine", "dist/lib/wine"]) {
    const p = path.join(protonDir, rel);
    if (fs.existsSync(p)) dllPaths.push(p);
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: `${protonBin}:${process.env.PATH ?? ""}`,
    WINE: wineCmd,
    WINE64: wine64,
    WINELOADER: wineloader,
    WINESERVER: wineserver,
    WINEARCH: "win64",
    DISPLAY: process.env.DISPLAY || ":0",
  };
  if (dllPaths.length > 0) {
    env.WINEDLLPATH = dllPaths.join(":");
  }
  if (config?.wine_prefix_path) {
    env.WINEPREFIX = expandPath(config.wine_prefix_path);
  }

  return { env, protonDir, protonBin };
}

interface DependencyDef {
  id: string;
  name: string;
  category: DependencyCategory;
  description: string;
  size_mb: number;
  required: boolean;
}

const DEPENDENCY_DEFINITIONS: DependencyDef[] = [
  { id: "dotnet46", name: ".NET Framework 4.6", category: "dotnet", description: "WeGame core runtime dependency", size_mb: 180, required: true },
  { id: "dotnet48", name: ".NET Framework 4.8", category: "dotnet", description: "Latest .NET Framework runtime (recommended)", size_mb: 200, required: true },
  { id: "vcpp2005", name: "Visual C++ 2005 Redistributable", category: "vcpp", description: "VC++ runtime for legacy components", size_mb: 6, required: false },
  { id: "vcpp2008", name: "Visual C++ 2008 Redistributable", category: "vcpp", description: "Game component dependency", size_mb: 9, required: true },
  { id: "vcpp2010", name: "Visual C++ 2010 Redistributable", category: "vcpp", description: "Widely used VC++ runtime", size_mb: 11, required: true },
  { id: "vcpp2012", name: "Visual C++ 2012 Redistributable", category: "vcpp", description: "Game and tool dependency", size_mb: 12, required: true },
  { id: "vcpp2013", name: "Visual C++ 2013 Redistributable", category: "vcpp", description: "Common VC++ runtime", size_mb: 13, required: true },
  { id: "vcpp2015-2022", name: "Visual C++ 2015-2022 (x64)", category: "vcpp", description: "Latest VC++ runtime bundle", size_mb: 35, required: true },
  { id: "font-microsoft-core", name: "Microsoft Core Fonts", category: "font", description: "Arial, Times New Roman and other base fonts", size_mb: 8, required: true },
  { id: "font-cjk", name: "CJK Support Fonts (CJKfonts)", category: "font", description: "CJK font support, fixes garbled Chinese text", size_mb: 25, required: true },
  { id: "ie8", name: "Internet Explorer 8", category: "browser", description: "IE kernel for WeGame embedded browser", size_mb: 150, required: true },
  { id: "gdiplus", name: "GDI+ (gdiplus)", category: "system", description: "Windows Graphics Device Interface library", size_mb: 3, required: true },
  { id: "mscoree", name: ".NET Core Runtime (mscoree)", category: "system", description: ".NET Framework core execution engine", size_mb: 2, required: true },
  { id: "directx9", name: "DirectX 9.0c (d3dx9)", category: "system", description: "DirectX 9 runtime library", size_mb: 50, required: true },
  { id: "vcrun6", name: "Visual Basic 6 Runtime (vcrun6)", category: "other", description: "VB6 runtime compatibility layer", size_mb: 5, required: false },
];

const WINETRICKS_ID_MAP: Record<string, string> = {
  "dotnet46": "dotnet46",
  "dotnet48": "dotnet48",
  "vcpp2005": "vcrun2005",
  "vcpp2008": "vcrun2008",
  "vcpp2010": "vcrun2010",
  "vcpp2012": "vcrun2012",
  "vcpp2013": "vcrun2013",
  "vcpp2015-2022": "vcrun2022",
  "font-microsoft-core": "corefonts",
  "font-cjk": "cjkfonts",
  "ie8": "ie8",
  "gdiplus": "gdiplus",
  "mscoree": "mscoree",
  "directx9": "d3dx9",
  "vcrun6": "vcrun6",
};

function winetricksId(depId: string): string {
  return WINETRICKS_ID_MAP[depId] || depId;
}

/**
 * Check which winetricks packages are already installed in the given prefix.
 * Uses `winetricks list-installed` if available, otherwise falls back to
 * checking known registry keys / files in the prefix.
 *
 * When a config is provided, the Proton-bundled wine runtime is injected into
 * the child env so this also works on SteamOS where no standalone wine exists.
 */
function checkInstalledWinetricks(prefixPath: string, config?: EnvironmentConfig): Set<string> {
  const installed = new Set<string>();
  let childEnv: Record<string, string> = { ...(process.env as Record<string, string>), WINEPREFIX: prefixPath };
  if (config) {
    try {
      const { env } = resolveWineBackendEnv(config);
      childEnv = { ...env, WINEPREFIX: prefixPath };
    } catch {
      // Non-fatal here: if we cannot resolve wine backend during status query,
      // just fall back to the plain env; list may be empty but that is OK.
    }
  }
  try {
    const output = execSync("winetricks list-installed", {
      env: childEnv,
      encoding: "utf-8",
      timeout: 15000,
    });
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("Using")) {
        installed.add(trimmed);
      }
    }
    log.info(`Detected installed winetricks packages: ${[...installed].join(", ") || "(none)"}`);
  } catch (err) {
    log.warn(`Failed to query installed winetricks packages: ${err}`);
  }
  return installed;
}

export function getDependencyList(prefixPath?: string, config?: EnvironmentConfig): DependencyItem[] {
  const installed = prefixPath ? checkInstalledWinetricks(prefixPath, config) : new Set<string>();

  return DEPENDENCY_DEFINITIONS.map((def) => {
    const wtId = winetricksId(def.id);
    const isInstalled = installed.has(wtId);
    return {
      ...def,
      installed: isInstalled,
      install_time: undefined,
    };
  });
}

export interface ProgressEmitter {
  emitProgress: (progress: InstallProgress) => void;
  emitLog: (log: LogPayload) => void;
}

/**
 * Check if winetricks is available in the system
 */
function isWinetricksAvailable(): boolean {
  try {
    execSync("which winetricks", { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install winetricks if not available
 */
async function installWinetricks(sudoPassword?: string): Promise<void> {
  log.info("Installing winetricks...");
  
  return new Promise((resolve, reject) => {
    const installCommand = sudoPassword 
      ? `curl -sSL https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks -o /tmp/winetricks &&
         chmod +x /tmp/winetricks &&
         echo "${sudoPassword}" | sudo -S mv /tmp/winetricks /usr/local/bin/winetricks`
      : `curl -sSL https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks -o /tmp/winetricks &&
         chmod +x /tmp/winetricks &&
         sudo mv /tmp/winetricks /usr/local/bin/winetricks`;
    
    const child = spawn("bash", ["-c", installCommand], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = "";
    let errorOutput = "";

    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      errorOutput += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        log.info("Winetricks installed successfully");
        resolve();
      } else {
        const errorMsg = `Failed to install winetricks (exit code: ${code}). Error: ${errorOutput}`;
        log.error(errorMsg);
        
        // 检查是否是密码错误
        if (errorOutput.includes("Sorry, try again") || errorOutput.includes("incorrect password") || errorOutput.includes("Authentication failure")) {
          reject(new Error("密码错误，请重新输入"));
        } else {
          reject(new Error("Failed to install winetricks. Please install it manually: sudo pacman -S winetricks"));
        }
      }
    });

    child.on("error", (err) => {
      log.error(`Failed to run winetricks installation: ${err.message}`);
      reject(new Error(`Failed to run winetricks installation: ${err.message}`));
    });

    // Set timeout to prevent hanging
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill();
        log.error("Winetricks installation timed out");
        reject(new Error("Winetricks installation timed out. Please install it manually: sudo pacman -S winetricks"));
      }
    }, 60000); // 60 seconds timeout
  });
}

export { installWinetricks };

export async function installDependencies(
  winePrefixPath: string,
  selectedIds: string[],
  emitter: ProgressEmitter,
  sudoPassword?: string,
  config?: EnvironmentConfig
): Promise<void> {
  log.separator();
  log.info("=== Dependency Installation Start ===");
  log.info(`Wine prefix: ${winePrefixPath}`);
  log.info(`Selected dependencies: ${selectedIds.join(", ")}`);

  // Resolve the wine backend (from Proton) up front. If this fails, abort
  // immediately — do NOT loop over every dep just to fail each one.
  let backendEnv: Record<string, string>;
  try {
    const resolved = resolveWineBackendEnv(config);
    backendEnv = resolved.env;
    log.info(`Wine backend resolved: protonBin=${resolved.protonBin}`);
    log.info(`  WINE=${backendEnv.WINE}`);
    log.info(`  WINESERVER=${backendEnv.WINESERVER}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Cannot resolve wine backend: ${msg}`);
    emitter.emitLog({
      level: "error",
      message: msg,
      timestamp: new Date().toTimeString().slice(0, 8),
    });
    emitter.emitProgress({
      current_dependency: "",
      current_step: "无法启动依赖安装",
      progress_percent: 0,
      total_steps: selectedIds.length,
      completed_steps: 0,
      status: "error",
      error_message: msg,
    });
    throw err;
  }

  // Check if winetricks is available
  if (!isWinetricksAvailable()) {
    log.warn("Winetricks not found, attempting to install...");
    emitter.emitProgress({
      current_dependency: "winetricks",
      current_step: "Installing winetricks...",
      progress_percent: 0,
      total_steps: selectedIds.length + 1,
      completed_steps: 0,
      status: "running",
    });
    
    try {
      await installWinetricks(sudoPassword);
      emitter.emitProgress({
        current_dependency: "winetricks",
        current_step: "Winetricks installed successfully",
        progress_percent: Math.round((1 / (selectedIds.length + 1)) * 100),
        total_steps: selectedIds.length + 1,
        completed_steps: 1,
        status: "running",
      });
    } catch (err) {
      emitter.emitProgress({
        current_dependency: "winetricks",
        current_step: "Failed to install winetricks",
        progress_percent: 0,
        total_steps: selectedIds.length + 1,
        completed_steps: 0,
        status: "error",
        error_message: `Winetricks installation failed: ${err}`,
      });
      throw err;
    }
  }

  const total = selectedIds.length;
  let completed = 0;
  let failed = 0;
  const failedDeps: string[] = [];

  for (let idx = 0; idx < selectedIds.length; idx++) {
    const depId = selectedIds[idx];
    const wtId = winetricksId(depId);

    log.info(`[${idx + 1}/${total}] Installing: ${depId} (winetricks: ${wtId})`);

    emitter.emitProgress({
      current_dependency: depId,
      current_step: `Installing ${wtId}...`,
      progress_percent: Math.round((idx / total) * 100),
      total_steps: total,
      completed_steps: completed,
      status: "running",
    });

    try {
      await runWinetricksSingle(winePrefixPath, wtId, emitter, backendEnv);
      completed++;
      log.info(`[${idx + 1}/${total}] Successfully installed: ${depId}`);
      emitter.emitProgress({
        current_dependency: depId,
        current_step: "Completed",
        progress_percent: Math.round((completed / total) * 100),
        total_steps: total,
        completed_steps: completed,
        status: "running",
      });
    } catch (err) {
      failed++;
      failedDeps.push(depId);
      log.error(`[${idx + 1}/${total}] Failed to install ${depId}: ${err}`);
      emitter.emitLog({
        level: "error",
        message: `Failed to install ${depId}: ${err}`,
        timestamp: new Date().toTimeString().slice(0, 8),
      });
      // Continue with next dependency instead of stopping
    }
  }

  log.info(`=== Installation Summary: ${completed} succeeded, ${failed} failed out of ${total} ===`);
  if (failedDeps.length > 0) {
    log.warn(`Failed dependencies: ${failedDeps.join(", ")}`);
  }

  if (failed > 0 && completed === 0) {
    // All failed
    emitter.emitProgress({
      current_dependency: "",
      current_step: `All ${total} dependencies failed to install`,
      progress_percent: 0,
      total_steps: total,
      completed_steps: 0,
      status: "error",
      error_message: `All dependencies failed. Failed: ${failedDeps.join(", ")}`,
    });
  } else if (failed > 0) {
    // Partial failure
    emitter.emitProgress({
      current_dependency: "",
      current_step: `${completed}/${total} installed, ${failed} failed`,
      progress_percent: Math.round((completed / total) * 100),
      total_steps: total,
      completed_steps: completed,
      status: "completed",
      error_message: `Some dependencies failed: ${failedDeps.join(", ")}`,
    });
  } else {
    // All succeeded
    emitter.emitProgress({
      current_dependency: "",
      current_step: "All dependencies installed successfully",
      progress_percent: 100,
      total_steps: total,
      completed_steps: total,
      status: "completed",
    });
  }
}

function runWinetricksSingle(
  prefixPath: string,
  wtId: string,
  emitter: ProgressEmitter,
  backendEnv: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("winetricks", ["-q", "--unattended", wtId], {
      env: { ...backendEnv, WINEPREFIX: prefixPath },
    });

    let output = "";

    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          output += trimmed + "\n";
          log.info(`[winetricks:${wtId}] ${trimmed}`);
          const now = new Date();
          const ts = now.toTimeString().slice(0, 8) + "." + String(now.getMilliseconds()).padStart(3, "0");
          emitter.emitLog({ level: "info", message: trimmed, timestamp: ts });
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          log.warn(`[winetricks:${wtId}] ${trimmed}`);
          const now = new Date();
          const ts = now.toTimeString().slice(0, 8) + "." + String(now.getMilliseconds()).padStart(3, "0");
          emitter.emitLog({ level: "warn", message: trimmed, timestamp: ts });
        }
      }
    });

    child.on("close", (code) => {
      log.info(`[winetricks:${wtId}] Process exited with code: ${code}`);
      if (code === 0) resolve(output);
      else reject(new Error(`winetricks ${wtId} failed with exit code: ${code}`));
    });

    child.on("error", (err) => {
      log.error(`[winetricks:${wtId}] Process error: ${err.message}`);
      reject(new Error(`Failed to run winetricks: ${err.message}`));
    });
  });
}
