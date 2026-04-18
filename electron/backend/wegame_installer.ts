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

// WeGame 官方下载策略（v1.8.1）：
// -----------------------------------------------------------------------
// 腾讯已不再提供 WeGame 本体的稳定公网静态直链（历史 URL
// https://dldir1.qq.com/WeGame/Setup/WeGameSetup.exe 现在返回 404）。
// pc.qq.com 的"立即下载"按钮实际上走的是腾讯电脑管家存根 + JS 动态合成，
// 既无法在 Linux/Wine 场景用，也随时可能再次变化。
//
// 因此方案：
//   1. 默认推荐"本地文件"：让用户自行从官方站点下载 .exe 后选中本地路径。
//      这是最稳的路径，与任何 CDN 变动解耦。
//   2. 仍保留"在线下载"作实验性兜底：按一个 URL 候选列表顺序探测，只要有
//      一个返回 HTTP 2xx 且 Content-Length 像合理安装包（>1MB）就用。用户
//      可通过 EnvironmentConfig.extra_env_vars.WEGAME_INSTALLER_URL 加自己
//      的镜像（例如内网或 GitHub Release）做最高优先级尝试。
//
// 所有候选 URL 在出厂时都可能已失效——这是设计内接受的状态，而不是 bug。
// 一旦全部失败，后端会返回明确的 "all-sources-404" 错误；前端会把用户
// 引导回"选择本地文件"的交互。
const DEFAULT_WEGAME_INSTALLER_URL_CANDIDATES: readonly string[] = [
  // 历史官方直链：保留以防腾讯恢复；当前全部 404，但成本仅是一次 HEAD 请求
  "https://dldir1.qq.com/WeGame/Setup/WeGameSetup.exe",
  "https://dldir1.qq.com/wegame/WeGameSetup.exe",
  "https://dldir1.qq.com/wegame/Setup/WeGameSetup.exe",
];
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
   * (if any), followed by the built-in fallbacks.
   *
   * NOTE: in v1.8.1+ the recommended path is to let the user supply a local
   * .exe. This field is kept so the UI can still offer an "online download"
   * button as a best-effort experimental fallback.
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
}

function getInstallerCacheDir(config?: EnvironmentConfig): string {
  const custom = config?.extra_env_vars?.WEGAME_INSTALLER_CACHE_DIR;
  if (custom) return expandPath(custom);
  // Follow the same convention as winetricks / GE-Proton caches
  return expandPath("~/.cache/decky-wegame/installers");
}

/** Build the ordered list of candidate URLs. User override (if set) takes
 *  priority over all built-in fallbacks. Dedup while preserving order. */
function resolveDownloadUrlCandidates(config?: EnvironmentConfig): string[] {
  const user = config?.extra_env_vars?.WEGAME_INSTALLER_URL;
  const out: string[] = [];
  if (user && user.trim()) out.push(user.trim());
  for (const u of DEFAULT_WEGAME_INSTALLER_URL_CANDIDATES) {
    if (!out.includes(u)) out.push(u);
  }
  return out;
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
 * Probe a URL with HEAD to verify it returns 2xx and an expected content-length.
 * Used to quickly skip 404/410 mirrors before committing to a full download.
 */
function probeUrl(url: string, timeoutMs = 10_000): Promise<{
  ok: boolean;
  statusCode: number;
  contentLength: number;
  finalUrl: string;
}> {
  return new Promise((resolve) => {
    const start = (u: string, depth: number) => {
      if (depth > 5) {
        resolve({ ok: false, statusCode: 0, contentLength: 0, finalUrl: u });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        resolve({ ok: false, statusCode: 0, contentLength: 0, finalUrl: u });
        return;
      }
      const proto = parsed.protocol === "https:" ? https : http;
      const req = proto.request(
        u,
        { method: "HEAD", headers: { "User-Agent": "WeGame-Launcher" } },
        (res) => {
          const code = res.statusCode || 0;
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            start(res.headers.location, depth + 1);
            return;
          }
          const len = parseInt(
            (res.headers["content-length"] as string | undefined) || "0",
            10
          );
          res.resume();
          resolve({
            ok: code === 200 && len > 1_000_000,
            statusCode: code,
            contentLength: len,
            finalUrl: u,
          });
        }
      );
      req.on("error", () => {
        resolve({ ok: false, statusCode: 0, contentLength: 0, finalUrl: u });
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ ok: false, statusCode: 0, contentLength: 0, finalUrl: u });
      });
      req.end();
    };
    start(url, 0);
  });
}

/**
 * Download the WeGame installer into the local cache.
 *
 * v1.8.1: instead of hitting one hard-coded URL, this walks the ordered
 * candidate list returned by `resolveDownloadUrlCandidates()`, HEAD-probing
 * each one first and downloading from the first one that returns a usable
 * 200 + reasonable content-length. If every candidate fails, a clear
 * "all sources unavailable" error is returned so the UI can fall back to
 * the "pick local file" flow.
 */
export async function downloadWegameInstaller(
  config: EnvironmentConfig,
  onProgress?: (p: InstallerProgress) => void
): Promise<{ success: boolean; cachedPath?: string; triedUrls?: string[]; error?: string }> {
  const info = getInstallerInfo(config);
  const candidates = info.downloadUrlCandidates;
  const triedUrls: string[] = [];

  onProgress?.({
    phase: "download",
    percent: 0,
    message: `准备在 ${candidates.length} 个候选下载源中尝试...`,
  });

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    triedUrls.push(url);
    onProgress?.({
      phase: "download",
      percent: 0,
      message: `[${i + 1}/${candidates.length}] 探测下载源：${url}`,
    });
    log.info(`[wegame-install] probing candidate ${i + 1}/${candidates.length}: ${url}`);

    const probe = await probeUrl(url);
    if (!probe.ok) {
      log.warn(
        `[wegame-install] candidate ${url} unavailable (status=${probe.statusCode}, length=${probe.contentLength})`
      );
      onProgress?.({
        phase: "download",
        percent: 0,
        message: `该源不可用（HTTP ${probe.statusCode || "error"}），尝试下一个...`,
      });
      continue;
    }

    // Candidate looks good — commit to downloading from it.
    try {
      onProgress?.({
        phase: "download",
        percent: 0,
        message: `开始下载 WeGame 安装器（${url}）`,
      });
      log.info(`[wegame-install] downloading from ${url}`);

      await downloadToFile(url, info.cachedPath, (p) => {
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
      return { success: true, cachedPath: info.cachedPath, triedUrls };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[wegame-install] download from ${url} failed: ${msg}`);
      // delete any partial file so the next candidate starts clean
      try {
        if (fs.existsSync(info.cachedPath)) fs.unlinkSync(info.cachedPath);
      } catch {
        /* noop */
      }
      onProgress?.({
        phase: "download",
        percent: 0,
        message: `该源下载失败（${msg}），尝试下一个...`,
      });
      // continue to next candidate
    }
  }

  const summary =
    `所有 ${candidates.length} 个候选下载源均不可用。` +
    `腾讯已不再提供稳定的 WeGame 安装器静态直链，建议改为手动下载：` +
    `打开 ${OFFICIAL_DOWNLOAD_PAGE_URL} 下载 WeGameSetup.exe 后，` +
    `点击页面上的「选择本地安装器文件」按钮导入。`;
  log.error(`[wegame-install] all sources failed: ${triedUrls.join(", ")}`);
  onProgress?.({
    phase: "error",
    percent: 0,
    message: summary,
    error: summary,
  });
  return { success: false, triedUrls, error: summary };
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
 * Install WeGame from a user-supplied local .exe file (PRD v1.8.1 §4.2.2 new).
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
