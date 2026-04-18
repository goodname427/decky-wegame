import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { spawn } from "child_process";
import os from "os";
import { EnvironmentConfig } from "./types";
import { expandPath, getPrefixPath } from "./environment";
import { resolveWineBackendEnv, ensureWinePrefixInitialized } from "./dependencies";
import { installerLogger as log } from "./logger";

/**
 * WeGame installer subsystem (PRD v1.7 §4.1 step 5 "Install WeGame").
 *
 * Responsibilities:
 *   1. Download the official WeGame setup installer (.exe) into the local
 *      cache directory.
 *   2. Run that installer inside the configured Wine prefix using the
 *      Proton-bundled wine64, so the end result is an installed WeGame
 *      under `<prefix>/drive_c/Program Files/Tencent/WeGame/`.
 *   3. Detect whether WeGame is already installed (avoids a reinstall).
 *
 * Why this exists: before v1.7 there was no flow to put WeGameLauncher.exe
 * into the prefix, which made `launchWegame()` permanently fail with
 * "WeGame executable not found". Users had to hand-drop the installer,
 * which was never documented anywhere.
 */

// Official Tencent WeGame installer. This is the stable "direct download"
// URL referenced by the public wegame.com.cn landing page. Users can
// override via EnvironmentConfig.wegame_installer_url if they already have
// a local mirror or newer build.
const DEFAULT_WEGAME_INSTALLER_URL =
  "https://dldir1.qq.com/WeGame/Setup/WeGameSetup.exe";
const DEFAULT_INSTALLER_FILENAME = "WeGameSetup.exe";

export interface InstallerInfo {
  /** Local cached path (may not yet exist). */
  cachedPath: string;
  /** True if cachedPath exists and is non-empty. */
  cached: boolean;
  /** Size on disk in bytes, or 0. */
  sizeBytes: number;
  /** Default remote URL (can be overridden by config). */
  defaultDownloadUrl: string;
}

export type InstallerPhase = "download" | "install" | "done" | "error";

export interface InstallerProgress {
  phase: InstallerPhase;
  /** 0-100 overall progress. */
  percent: number;
  message?: string;
  /** Only set on "error". */
  error?: string;
}

function getInstallerCacheDir(config?: EnvironmentConfig): string {
  const custom = config?.extra_env_vars?.WEGAME_INSTALLER_CACHE_DIR;
  if (custom) return expandPath(custom);
  // Follow the same convention as winetricks / GE-Proton caches
  return expandPath("~/.cache/decky-wegame/installers");
}

export function getInstallerInfo(config?: EnvironmentConfig): InstallerInfo {
  const dir = getInstallerCacheDir(config);
  const cachedPath = path.join(dir, DEFAULT_INSTALLER_FILENAME);
  let cached = false;
  let sizeBytes = 0;
  try {
    if (fs.existsSync(cachedPath)) {
      const st = fs.statSync(cachedPath);
      // Treat anything < 1 MB as "not really downloaded" (official installer
      // is dozens of MB; small files are almost certainly aborted downloads).
      if (st.isFile() && st.size > 1_000_000) {
        cached = true;
        sizeBytes = st.size;
      }
    }
  } catch {
    // fall through — treat as not cached
  }
  return {
    cachedPath,
    cached,
    sizeBytes,
    defaultDownloadUrl: DEFAULT_WEGAME_INSTALLER_URL,
  };
}

/**
 * Look for an existing WeGame installation inside the prefix.
 */
export function isWegameInstalled(config: EnvironmentConfig): {
  installed: boolean;
  exePath?: string;
} {
  const prefix = getPrefixPath(config);
  const candidates: string[] = [];
  if (config.wegame_install_path) {
    candidates.push(
      path.join(expandPath(config.wegame_install_path), "WeGameLauncher.exe")
    );
  }
  candidates.push(
    path.join(prefix, "drive_c/Program Files/Tencent/WeGame/WeGameLauncher.exe"),
    path.join(prefix, "drive_c/Program Files (x86)/Tencent/WeGame/WeGameLauncher.exe"),
    path.join(prefix, "drive_c/Program Files/Tencent/WeGame/WeGame.exe")
  );
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { installed: true, exePath: c };
    }
  }
  return { installed: false };
}

function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (p: { percent: number; downloaded: number; total: number }) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const make = (u: string, depth: number) => {
      if (depth > 5) return reject(new Error("Too many redirects"));
      const parsed = new URL(u);
      const proto = parsed.protocol === "https:" ? https : http;
      proto
        .get(u, { headers: { "User-Agent": "WeGame-Launcher" } }, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            make(res.headers.location, depth + 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }
          const total = parseInt(res.headers["content-length"] || "0", 10);
          let downloaded = 0;
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const ws = fs.createWriteStream(destPath);
          res.on("data", (chunk: Buffer) => {
            downloaded += chunk.length;
            if (onProgress && total > 0) {
              onProgress({
                percent: Math.round((downloaded / total) * 100),
                downloaded,
                total,
              });
            }
          });
          res.pipe(ws);
          ws.on("finish", () => {
            ws.close();
            resolve();
          });
          ws.on("error", (err) => {
            try {
              fs.unlinkSync(destPath);
            } catch {
              /* noop */
            }
            reject(err);
          });
        })
        .on("error", reject);
    };
    make(url, 0);
  });
}

/**
 * Download the WeGame installer into the local cache.
 *
 * Resolves with the local path to the downloaded file on success.
 */
export async function downloadWegameInstaller(
  config: EnvironmentConfig,
  onProgress?: (p: InstallerProgress) => void
): Promise<{ success: boolean; cachedPath?: string; error?: string }> {
  try {
    const info = getInstallerInfo(config);
    const url =
      config.extra_env_vars?.WEGAME_INSTALLER_URL ||
      DEFAULT_WEGAME_INSTALLER_URL;

    onProgress?.({
      phase: "download",
      percent: 0,
      message: `开始下载 WeGame 安装器 (${url})`,
    });
    log.info(`[wegame-install] downloading installer from ${url}`);

    await downloadToFile(url, info.cachedPath, (p) => {
      // 0-95% for download, leave headroom for the launch step
      const mapped = Math.min(95, Math.round(p.percent * 0.95));
      onProgress?.({
        phase: "download",
        percent: mapped,
        message: `下载中 ${p.percent}% (${Math.round(p.downloaded / 1024 / 1024)}MB / ${Math.round(p.total / 1024 / 1024)}MB)`,
      });
    });

    onProgress?.({
      phase: "download",
      percent: 100,
      message: `安装器已下载到 ${info.cachedPath}`,
    });
    log.info(`[wegame-install] installer cached: ${info.cachedPath}`);
    return { success: true, cachedPath: info.cachedPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[wegame-install] download failed: ${msg}`);
    onProgress?.({
      phase: "error",
      percent: 0,
      message: `下载失败：${msg}`,
      error: msg,
    });
    return { success: false, error: msg };
  }
}

/**
 * Run a WeGame installer .exe inside the Wine prefix using the Proton-bundled
 * wine64 runtime.
 *
 * Note: the installer is a GUI Windows program; we cannot reliably tell how
 * far through the user is — we just report "installer running" and then mark
 * success when the process exits cleanly AND WeGameLauncher.exe appears in
 * the prefix afterwards.
 */
export async function runWegameInstaller(
  installerPath: string,
  config: EnvironmentConfig,
  onProgress?: (p: InstallerProgress) => void
): Promise<{ success: boolean; exePath?: string; error?: string }> {
  const absInstaller = expandPath(installerPath);
  if (!fs.existsSync(absInstaller)) {
    const msg = `安装器文件不存在：${absInstaller}`;
    onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
    return { success: false, error: msg };
  }

  let env: Record<string, string>;
  try {
    const resolved = resolveWineBackendEnv(config);
    env = resolved.env;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
    return { success: false, error: msg };
  }

  const prefixPath = getPrefixPath(config);
  env.WINEPREFIX = prefixPath;

  onProgress?.({
    phase: "install",
    percent: 0,
    message: "检查 Wine 前缀初始化状态...",
  });

  try {
    await ensureWinePrefixInitialized(prefixPath, env, {
      emitLog: (payload) => {
        onProgress?.({
          phase: "install",
          percent: 5,
          message: payload.message,
        });
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
    return { success: false, error: msg };
  }

  const wineCmd = env.WINE || env.WINE64;
  if (!wineCmd) {
    const msg = "未解析到可用的 wine 可执行文件";
    onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
    return { success: false, error: msg };
  }

  log.info(`[wegame-install] launching installer: ${wineCmd} ${absInstaller}`);
  onProgress?.({
    phase: "install",
    percent: 15,
    message: "正在启动 WeGame 安装程序，请在弹出的窗口中完成安装...",
  });

  return await new Promise((resolve) => {
    const child = spawn(wineCmd, [absInstaller], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: os.tmpdir(),
    });

    // Heartbeat: tick progress slowly so the UI doesn't look stuck while
    // the user clicks through the installer wizard. Cap at 80% — the final
    // 20% is claimed after the installer exits AND we verify the binary.
    let tick = 15;
    const heartbeat = setInterval(() => {
      if (tick < 80) {
        tick += 1;
        onProgress?.({
          phase: "install",
          percent: tick,
          message: "安装进行中，请在 WeGame 安装向导里完成所有步骤...",
        });
      }
    }, 5_000);

    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const t = line.trim();
        if (t) log.info(`[wegame-install:stdout] ${t}`);
      }
    });
    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const t = line.trim();
        if (t) log.warn(`[wegame-install:stderr] ${t}`);
      }
    });

    child.on("error", (err) => {
      clearInterval(heartbeat);
      const msg = err.message;
      log.error(`[wegame-install] spawn error: ${msg}`);
      onProgress?.({
        phase: "error",
        percent: 0,
        message: `启动安装器失败：${msg}`,
        error: msg,
      });
      resolve({ success: false, error: msg });
    });

    child.on("close", (code) => {
      clearInterval(heartbeat);
      log.info(`[wegame-install] installer exited with code=${code}`);
      onProgress?.({
        phase: "install",
        percent: 90,
        message: "安装器已退出，正在校验安装结果...",
      });

      const check = isWegameInstalled(config);
      if (check.installed && check.exePath) {
        onProgress?.({
          phase: "done",
          percent: 100,
          message: `WeGame 安装完成：${check.exePath}`,
        });
        resolve({ success: true, exePath: check.exePath });
      } else {
        const msg =
          code === 0
            ? "安装器已正常退出，但未在 prefix 中找到 WeGameLauncher.exe。可能是您在向导中取消了安装，请重试。"
            : `安装器退出码异常 (${code})，且未检测到 WeGame 已安装。请查看日志排查原因。`;
        onProgress?.({
          phase: "error",
          percent: 0,
          message: msg,
          error: msg,
        });
        resolve({ success: false, error: msg });
      }
    });
  });
}

/**
 * Full "download then install" convenience flow used by the SetupWizard.
 *
 * If the installer is already cached (and not explicitly refreshed), the
 * download step is skipped. This is important on Steam Deck where the
 * installer is ~50 MB and users may retry several times.
 */
export async function downloadAndInstallWegame(
  config: EnvironmentConfig,
  opts: { forceRedownload?: boolean } = {},
  onProgress?: (p: InstallerProgress) => void
): Promise<{ success: boolean; exePath?: string; error?: string }> {
  const info = getInstallerInfo(config);

  let installerPath = info.cachedPath;
  if (!info.cached || opts.forceRedownload) {
    const dl = await downloadWegameInstaller(config, onProgress);
    if (!dl.success || !dl.cachedPath) {
      return { success: false, error: dl.error || "下载失败" };
    }
    installerPath = dl.cachedPath;
  } else {
    onProgress?.({
      phase: "download",
      percent: 95,
      message: `检测到已下载的安装器 (${Math.round(info.sizeBytes / 1024 / 1024)}MB)，跳过下载`,
    });
  }

  return await runWegameInstaller(installerPath, config, onProgress);
}

/**
 * Clear the cached installer (helpful when the download was corrupted or a
 * newer official release is needed).
 */
export function clearInstallerCache(config?: EnvironmentConfig): {
  success: boolean;
  error?: string;
} {
  try {
    const dir = getInstallerCacheDir(config);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
