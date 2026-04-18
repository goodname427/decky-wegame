import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import os from "os";
import { EnvironmentConfig } from "./types";
import { expandPath, getPrefixPath } from "./environment";
import { resolveWineBackendEnv, ensureWinePrefixInitialized } from "./dependencies";
import { installerLogger as log } from "./logger";
import { downloadFromMirrorPool, expandMirrorCandidates } from "./mirrors";

// ---------------------------------------------------------------------------
// Module-scoped state: currently-running installer child process.
// Exposed via killRunningInstaller() so the auto-setup cancel path can tear
// the Wine subtree down without having to wait 1-2 minutes for the GUI to
// time out on its own.
// ---------------------------------------------------------------------------

let currentInstallerChild: ChildProcess | null = null;

/**
 * Best-effort SIGTERM the currently-running WeGame installer (if any). If
 * the child is still alive 30s later, we follow up with SIGKILL as a
 * backstop — some Wine subtree configurations ignore SIGTERM because the
 * wine server refcount keeps the winevdm / wineconsole children pinned.
 *
 * Returns true iff there was a live installer to signal. Safe to call
 * multiple times; subsequent calls no-op.
 */
export function killRunningInstaller(): boolean {
  const child = currentInstallerChild;
  if (!child || child.killed || child.exitCode != null) return false;
  log.warn("[wegame-install] SIGTERM to installer (user cancelled)");
  try {
    child.kill("SIGTERM");
  } catch (err) {
    log.warn(`[wegame-install] SIGTERM failed: ${(err as Error).message}`);
  }
  setTimeout(() => {
    const stillThere = currentInstallerChild;
    if (stillThere && !stillThere.killed && stillThere.exitCode == null) {
      log.warn("[wegame-install] installer ignored SIGTERM; sending SIGKILL");
      try {
        stillThere.kill("SIGKILL");
      } catch (err) {
        log.warn(`[wegame-install] SIGKILL failed: ${(err as Error).message}`);
      }
    }
  }, 30_000);
  return true;
}

/**
 * WeGame installer subsystem (PRD §4.1.1 step 5 "Install WeGame").
 *
 * Responsibilities:
 *   1. Download the official WeGame setup installer (.exe) into the local
 *      cache directory, going through the shared mirror pool
 *      (poolId = "wegame-installer").
 *   2. Run that installer inside the configured Wine prefix using the
 *      Proton-bundled wine64, so the end result is an installed WeGame
 *      under `<prefix>/drive_c/Program Files/Tencent/WeGame/`.
 *   3. Detect whether WeGame is already installed (avoids a reinstall).
 *
 * All external URLs consumed here live in mirror-manifest.json; this file
 * only owns the Wine-side install orchestration.
 */

// WeGame 官方下载策略（PRD §4.1.1.5）：
// - 腾讯没有稳定的公网静态直链；mirror-manifest.json 的 "wegame-installer"
//   池里收录的候选全部都可能当前 404。这是设计内可接受的状态。
// - 用户可通过 extra_env_vars.WEGAME_INSTALLER_URL 覆盖，自动拼到候选列表最前。
// - 若整池全挂，后端返回 "all-sources-404" 语义；前端会引导回 L3「选择本地
//   安装器文件」的交互。
const DEFAULT_INSTALLER_FILENAME = "WeGameSetup.exe";
const OFFICIAL_DOWNLOAD_PAGE_URL = "https://www.wegame.com.cn/";

export interface InstallerInfo {
  /** Local cached path (may not yet exist). */
  cachedPath: string;
  /** True if cachedPath exists and is non-empty. */
  cached: boolean;
  /** Size on disk in bytes, or 0. */
  sizeBytes: number;
  /**
   * All candidate remote URLs that will be tried in order during the online
   * "download installer" flow. The first entry is the user-overridden URL
   * (if any), followed by the built-in fallbacks from the mirror manifest.
   *
   * The recommended path remains "pick local file" — this list exists so the
   * UI can still offer an "online download" button as a best-effort fallback.
   */
  downloadUrlCandidates: string[];
  /** Official download page URL shown to the user when all mirrors fail. */
  officialDownloadPage: string;
}

export type InstallerPhase = "download" | "install" | "done" | "error";

export interface InstallerProgress {
  phase: InstallerPhase;
  /** 0-100 overall progress. */
  percent: number;
  message?: string;
  /** Only set on "error". */
  error?: string;
  /** Soft-warning tag surfaced on non-terminal frames (e.g. "installer-silent"
   *  when the Wine installer hasn't produced any stdout/stderr for a while).
   *  The UI may display a dismissible banner; never fatal on its own. */
  warning?: string;
}

function getInstallerCacheDir(config?: EnvironmentConfig): string {
  const custom = config?.extra_env_vars?.WEGAME_INSTALLER_CACHE_DIR;
  if (custom) return expandPath(custom);
  // Follow the same convention as winetricks / GE-Proton caches
  return expandPath("~/.cache/decky-wegame/installers");
}

/** Build the ordered list of candidate URLs via the mirror manifest. User
 *  override (if set) is inserted with the highest priority. */
function resolveDownloadUrlCandidates(config?: EnvironmentConfig): string[] {
  const user = config?.extra_env_vars?.WEGAME_INSTALLER_URL;
  const extra = user && user.trim() ? [user.trim()] : [];
  return expandMirrorCandidates("wegame-installer", undefined, extra);
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
    downloadUrlCandidates: resolveDownloadUrlCandidates(config),
    officialDownloadPage: OFFICIAL_DOWNLOAD_PAGE_URL,
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

/**
 * Download the WeGame installer into the local cache.
 *
 * Strategy:
 *   - Candidate list = user override (if any) + "wegame-installer" pool from
 *     mirror-manifest.json, resolved by `resolveDownloadUrlCandidates`.
 *   - Delegates to `downloadFromMirrorPool`, which HEAD-probes each candidate,
 *     streams the first healthy one, enforces minBytes = 1 MB to reject tiny
 *     404 HTML bodies, and emits unified `[Mirror] …` logs.
 *   - Returns `{success: false, triedUrls, error}` when every candidate fails
 *     so the UI can fall back to the "pick local installer file" flow (L3).
 */
export async function downloadWegameInstaller(
  config: EnvironmentConfig,
  onProgress?: (p: InstallerProgress) => void
): Promise<{ success: boolean; cachedPath?: string; triedUrls?: string[]; error?: string }> {
  const info = getInstallerInfo(config);
  const candidates = info.downloadUrlCandidates;

  onProgress?.({
    phase: "download",
    percent: 0,
    message: `准备在 ${candidates.length} 个候选下载源中尝试...`,
  });
  log.info(
    `[wegame-install] starting download, ${candidates.length} candidate(s)`
  );

  const result = await downloadFromMirrorPool(
    "wegame-installer",
    candidates,
    {
      destPath: info.cachedPath,
      // Real WeGame installer is dozens of MB; <1 MB almost certainly means
      // a 404 HTML body slipped past the HEAD probe.
      minBytes: 1_000_000,
      timeoutMs: 5 * 60_000,
      onProgress: (p) => {
        const mapped = Math.min(95, Math.round(p.percent * 0.95));
        onProgress?.({
          phase: "download",
          percent: mapped,
          message: `下载中 ${p.percent}% (${Math.round(p.downloaded / 1024 / 1024)}MB / ${Math.round(p.total / 1024 / 1024)}MB)`,
        });
      },
    }
  );

  if (result.ok) {
    onProgress?.({
      phase: "download",
      percent: 100,
      message: `安装器已下载到 ${info.cachedPath}`,
    });
    log.info(`[wegame-install] installer cached: ${info.cachedPath}`);
    return { success: true, cachedPath: info.cachedPath, triedUrls: result.triedUrls };
  }

  const summary =
    `所有 ${result.triedUrls.length} 个候选下载源均不可用。` +
    `腾讯已不再提供稳定的 WeGame 安装器静态直链，建议改为手动下载：` +
    `打开 ${OFFICIAL_DOWNLOAD_PAGE_URL} 下载 WeGameSetup.exe 后，` +
    `点击页面上的「选择本地安装器文件」按钮导入。`;
  log.error(
    `[wegame-install] all sources failed: ${result.triedUrls.join(", ")}`
  );
  onProgress?.({
    phase: "error",
    percent: 0,
    message: summary,
    error: summary,
  });
  return { success: false, triedUrls: result.triedUrls, error: summary };
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
): Promise<{ success: boolean; exePath?: string; error?: string; needsLocalFile?: boolean }> {
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

  // Enable HTTP/TLS/socket tracing inside the Wine process so that if the
  // WeGame setup.exe's own HTTPS fetch stalls (a frequent root cause on
  // Steam Deck — Tencent CDN TLS handshake timing out through the default
  // Valve routing), the installer.log actually contains a hint. We respect
  // an existing WINEDEBUG value and only append our categories.
  const baseDebug = env.WINEDEBUG && env.WINEDEBUG.trim() ? env.WINEDEBUG.trim() : "-all";
  env.WINEDEBUG = `${baseDebug},+winhttp,+wininet,+winsock`;

  log.info(`[wegame-install] launching installer: ${wineCmd} ${absInstaller}`);
  log.info(`[wegame-install] WINEDEBUG=${env.WINEDEBUG}`);
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
    // Publish the handle so outside callers (e.g. the auto-setup cancel
    // path) can SIGTERM the Wine subtree without racing this Promise. The
    // close handler clears it.
    currentInstallerChild = child;

    // Heartbeat: tick progress slowly so the UI doesn't look stuck while
    // the user clicks through the installer wizard. Cap at 80% — the final
    // 20% is claimed after the installer exits AND we verify the binary.
    //
    // We also use the same interval to detect "installer has been silent
    // for too long" and surface a soft warning exactly once. This is C2:
    // after 3 minutes with no stdout/stderr output, we nudge the UI toward
    // the "maybe switch to advanced mode / run diagnostics" escape hatch
    // rather than leaving the user staring at a frozen progress bar.
    let tick = 15;
    let lastOutputAt = Date.now();
    let silenceWarned = false;
    const SILENCE_WARN_MS = 3 * 60_000;
    const heartbeat = setInterval(() => {
      if (tick < 80) {
        tick += 1;
        onProgress?.({
          phase: "install",
          percent: tick,
          message: "安装进行中，请在 WeGame 安装向导里完成所有步骤...",
        });
      }
      if (!silenceWarned && Date.now() - lastOutputAt > SILENCE_WARN_MS) {
        silenceWarned = true;
        log.warn(
          `[wegame-install] installer silent for ${Math.floor((Date.now() - lastOutputAt) / 1000)}s — likely network stall`
        );
        onProgress?.({
          phase: "install",
          percent: tick,
          message:
            "安装器已 3 分钟没有新输出 — 通常是腾讯 CDN 下载被卡住。你可以：1) 继续等待；2) 切换到高级模式手动处理；3) 运行 WeGame 诊断查看网络状况。",
          warning: "installer-silent",
        });
      }
    }, 5_000);

    const bumpActivity = (): void => {
      lastOutputAt = Date.now();
    };

    child.stdout?.on("data", (data: Buffer) => {
      bumpActivity();
      for (const line of data.toString().split("\n")) {
        const t = line.trim();
        if (t) log.info(`[wegame-install:stdout] ${t}`);
      }
    });
    child.stderr?.on("data", (data: Buffer) => {
      bumpActivity();
      for (const line of data.toString().split("\n")) {
        const t = line.trim();
        if (t) log.warn(`[wegame-install:stderr] ${t}`);
      }
    });

    child.on("error", (err) => {
      clearInterval(heartbeat);
      currentInstallerChild = null;
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

    child.on("close", (code, signal) => {
      clearInterval(heartbeat);
      currentInstallerChild = null;
      log.info(`[wegame-install] installer exited code=${code} signal=${signal ?? "-"}`);

      // If we were killed via killRunningInstaller(), don't misblame the
      // mirror pool — short-circuit with a cancel-shaped error so the
      // auto-setup error card surfaces "cancelled" cleanly.
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        onProgress?.({
          phase: "error",
          percent: 0,
          message: "安装器已被取消",
          error: "cancelled",
        });
        resolve({ success: false, error: "cancelled" });
        return;
      }

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
      } else if (code === 0) {
        // Exit code 0 but no WeGameLauncher.exe on disk is the classic
        // "Tencent setup downloader stalled at 0% then gave up quietly"
        // failure mode. We flag it with needsLocalFile=true so the caller
        // (auto-setup orchestrator) can render the "pick local installer"
        // escape hatch without pattern-matching on Chinese error text.
        const msg =
          "安装器已正常退出，但未在 prefix 中找到 WeGameLauncher.exe — 这通常意味着腾讯 CDN 下载被网络阻塞。建议改用本地安装器文件。";
        onProgress?.({
          phase: "error",
          percent: 0,
          message: msg,
          error: msg,
        });
        resolve({ success: false, error: msg, needsLocalFile: true });
      } else {
        const msg = `安装器退出码异常 (${code})，且未检测到 WeGame 已安装。请查看日志排查原因。`;
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
): Promise<{ success: boolean; exePath?: string; error?: string; needsLocalFile?: boolean }> {
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
 * Install WeGame from a user-supplied local .exe file (PRD §4.2.2).
 *
 * The file is copied into the installer cache directory (if it's not already
 * there) so subsequent reinstalls don't rely on the user's original path
 * being stable. Validation is minimal on purpose — we check the file exists,
 * is non-empty, ends with .exe (case-insensitive); deeper content checks are
 * left to the Wine installer itself (it will loudly fail if the file is not
 * a real PE binary).
 */
export async function installWegameFromLocalFile(
  localPath: string,
  config: EnvironmentConfig,
  onProgress?: (p: InstallerProgress) => void
): Promise<{ success: boolean; exePath?: string; error?: string }> {
  try {
    const abs = expandPath(localPath);
    if (!abs || !fs.existsSync(abs)) {
      const msg = `选中的文件不存在：${abs || localPath}`;
      onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
      return { success: false, error: msg };
    }
    const st = fs.statSync(abs);
    if (!st.isFile()) {
      const msg = `所选路径不是文件：${abs}`;
      onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
      return { success: false, error: msg };
    }
    if (st.size < 1_000_000) {
      const msg = `文件过小（${st.size} 字节），可能不是完整的 WeGame 安装器。请重新下载。`;
      onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
      return { success: false, error: msg };
    }
    if (!/\.exe$/i.test(abs)) {
      const msg = `文件扩展名不是 .exe：${abs}`;
      onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
      return { success: false, error: msg };
    }

    // Copy into cache so future reinstalls don't need the user to re-browse.
    const info = getInstallerInfo(config);
    const dir = path.dirname(info.cachedPath);
    fs.mkdirSync(dir, { recursive: true });
    let installerPath = abs;
    try {
      if (path.resolve(abs) !== path.resolve(info.cachedPath)) {
        onProgress?.({
          phase: "download",
          percent: 50,
          message: `正在将安装器复制到缓存目录 (${Math.round(st.size / 1024 / 1024)}MB)...`,
        });
        fs.copyFileSync(abs, info.cachedPath);
        installerPath = info.cachedPath;
        log.info(`[wegame-install] copied local installer -> ${info.cachedPath}`);
      }
      onProgress?.({
        phase: "download",
        percent: 100,
        message: `安装器就绪：${installerPath}`,
      });
    } catch (err) {
      // Copy is a nice-to-have; if it fails we can still run directly from abs.
      log.warn(`[wegame-install] copy-to-cache failed, will run from original path: ${(err as Error).message}`);
      installerPath = abs;
    }

    return await runWegameInstaller(installerPath, config, onProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[wegame-install] installFromLocalFile failed: ${msg}`);
    onProgress?.({ phase: "error", percent: 0, message: msg, error: msg });
    return { success: false, error: msg };
  }
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
