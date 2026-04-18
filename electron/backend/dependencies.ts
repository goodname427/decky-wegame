import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { DependencyItem, DependencyCategory, EnvironmentConfig, InstallProgress, LogPayload } from "./types";
import { expandPath } from "./environment";
import { scanProtonVersions, getDefaultProtonPath } from "./proton";
import { depsLogger as log, Log } from "./logger";
import { preseedWinetricksCache } from "./mirrors";

/** Dedicated logger for the wineboot initialization pipeline. */
const wineBootLog = Log.category("WineBoot");

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

  // 4b. Compose LD_LIBRARY_PATH so the Proton-bundled wine binaries can find
  // their private libs (libwine.so etc.). Without this, `wine64 foo.exe`
  // typically hangs silently right after printing the initial `cd` line.
  const ldPaths: string[] = [];
  for (const rel of ["files/lib64", "files/lib", "dist/lib64", "dist/lib"]) {
    const p = path.join(protonDir, rel);
    if (fs.existsSync(p)) ldPaths.push(p);
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
    // Force winetricks to run fully non-interactively:
    //   - W_OPT_UNATTENDED=1 is stronger than --unattended and skips EULA/GUI dialogs
    //   - WINETRICKS_GUI=none disables zenity/kdialog fallback that would block on stdin
    //   - WINEDEBUG=-all silences the normal wine firehose so progress logs stay readable
    W_OPT_UNATTENDED: "1",
    WINETRICKS_GUI: "none",
    WINEDEBUG: process.env.WINEDEBUG || "-all",
    // Prevent winetricks from hitting GitHub to self-update at start-up,
    // which can hang for minutes behind the GFW.
    WINETRICKS_LATEST_VERSION_CHECK: "disabled",
  };
  if (dllPaths.length > 0) {
    env.WINEDLLPATH = dllPaths.join(":");
  }
  if (ldPaths.length > 0) {
    env.LD_LIBRARY_PATH = `${ldPaths.join(":")}:${process.env.LD_LIBRARY_PATH ?? ""}`;
  }
  if (config?.wine_prefix_path) {
    env.WINEPREFIX = expandPath(config.wine_prefix_path);
  }

  return { env, protonDir, protonBin };
}

/**
 * Ensure the wine prefix is fully initialized before any winetricks operation.
 *
 * Symptom we fight here (seen in logs/dependencies_20260418_153815.log):
 *   wine: failed to open "C:\windows\syswow64\regedit.exe": c0000135
 *
 * Root cause: on a *brand new* prefix (or one created by the wizard's
 * "initialize" step that only did `mkdir`), the Proton-bundled wine hasn't
 * populated `syswow64/regedit.exe` yet, so winetricks fails the moment it
 * tries to register a font with `wine64 regedit /S …`.
 *
 * Fix: if we can't see `syswow64/regedit.exe`, run `wineboot --init` with
 * the exact same env that resolveWineBackendEnv produced, and wait for
 * wineserver to settle. This is idempotent — subsequent runs are cheap
 * because the file check short-circuits immediately.
 */
/**
 * A prefix is considered "healthy" for 64-bit wine use only when *all* of
 * these files are present:
 *   - drive_c/windows/syswow64/regedit.exe   (wineboot finished staging
 *     the wow64 tree)
 *   - drive_c/windows/syswow64/kernel32.dll  (32-bit kernel32 under wow64)
 *   - drive_c/windows/system32/kernel32.dll  (64-bit kernel32)
 *
 * A single-file sentinel ("does regedit.exe exist?") has historically been
 * enough, but in the field we have seen degraded prefixes where the
 * sentinel file is present yet a core DLL is missing — wine64 then refuses
 * to start with `c0000135 (DLL_NOT_FOUND)`. We have also seen prefixes
 * that only contain a 32-bit `system32/` tree (no `syswow64/` at all),
 * which makes wine64 unable to load kernel32 as well. Checking the full
 * triple catches both failure modes up front.
 */
function collectPrefixHealthStatus(prefix: string): {
  healthy: boolean;
  missing: string[];
} {
  const required = [
    path.join(prefix, "drive_c", "windows", "syswow64", "regedit.exe"),
    path.join(prefix, "drive_c", "windows", "syswow64", "kernel32.dll"),
    path.join(prefix, "drive_c", "windows", "system32", "kernel32.dll"),
  ];
  const missing = required.filter((p) => !fs.existsSync(p));
  return { healthy: missing.length === 0, missing };
}

export async function ensureWinePrefixInitialized(
  prefixPath: string,
  env: Record<string, string>,
  emitter?: { emitLog: (log: LogPayload) => void }
): Promise<void> {
  const prefix = expandPath(prefixPath);

  const health = collectPrefixHealthStatus(prefix);
  if (health.healthy) {
    return; // already initialized — fast path
  }

  // Decide whether this is a "first-time init" or a "repair an existing
  // broken prefix" case. The user-facing message differs slightly, and only
  // the latter needs a hard wipe.
  const prefixExists = fs.existsSync(prefix);
  const isRepair = prefixExists && fs.readdirSync(prefix).length > 0;

  if (isRepair) {
    log.warn(
      `[wineboot] prefix exists but is unhealthy, missing:\n  - ${health.missing.join("\n  - ")}\n  → wiping and re-initializing`
    );
    emitter?.emitLog({
      level: "warn",
      message:
        "检测到 Wine 前缀残缺（缺少关键 DLL），将清空该目录后重新初始化。这通常发生在之前的 wineboot 被中断或 arch 不一致时。",
      timestamp: new Date().toTimeString().slice(0, 8),
    });
    // Hard wipe: remove the whole prefix directory so wineboot has a
    // guaranteed clean slate. Our prefix directory is, by convention,
    // owned entirely by this app (default is ~/.local/share/decky-wegame/prefix),
    // so it's safe to nuke.
    try {
      fs.rmSync(prefix, { recursive: true, force: true });
    } catch (err) {
      throw new Error(
        `清理残缺的 Wine 前缀失败：${(err as Error).message}。请手动删除 ${prefix} 后重试。`
      );
    }
  } else {
    log.info(`[wineboot] prefix not initialized (${prefix}), running wineboot --init`);
    emitter?.emitLog({
      level: "info",
      message: "首次初始化 Wine 前缀中，请稍候（这一步只做一次，可能需要 30 秒～1 分钟）...",
      timestamp: new Date().toTimeString().slice(0, 8),
    });
  }

  // (Re-)create prefix dir; wineboot will populate the rest.
  fs.mkdirSync(prefix, { recursive: true });

  const wineCmd = env.WINE || env.WINE64;
  if (!wineCmd) {
    throw new Error("内部错误：缺少 WINE 环境变量，无法初始化 prefix");
  }

  // Force WINEPREFIX onto the resolved absolute path, and explicitly pin
  // WINEARCH=win64 so a stray shell export (or an environment where wine
  // would otherwise infer win32) cannot produce a 32-bit-only prefix
  // that wine64 then fails to load.
  const bootEnv: Record<string, string> = {
    ...env,
    WINEPREFIX: prefix,
    WINEARCH: "win64",
    // wineboot itself must NOT be muffled by -all or we'll lose useful errors
    WINEDEBUG: env.WINEDEBUG || "-all",
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(wineCmd, ["wineboot", "--init"], {
      env: bootEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    wineBootLog.log(
      `spawn: ${wineCmd} wineboot --init  WINEPREFIX=${prefix} WINEARCH=${bootEnv.WINEARCH}`
    );

    // Capture stdout/stderr. Each chunk is written to the session log under
    // LogWineBoot at VeryVerbose, *and* appended to an in-memory rolling
    // buffer so that when wineboot fails we can attach the tail of its
    // output to the thrown Error (UE-style: raw output is never silently
    // dropped).
    const RING_MAX = 200;
    const ring: string[] = [];
    const pushLines = (stream: "stdout" | "stderr", chunk: string) => {
      const lines = chunk.replace(/\r/g, "").split("\n");
      for (const raw of lines) {
        if (raw === "") continue;
        const tagged = `[${stream}] ${raw}`;
        wineBootLog.veryVerbose(tagged);
        ring.push(tagged);
        if (ring.length > RING_MAX) ring.shift();
      }
    };

    let lastBytes = Date.now();
    child.stdout?.on("data", (buf: Buffer) => {
      lastBytes = Date.now();
      pushLines("stdout", buf.toString("utf8"));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      lastBytes = Date.now();
      pushLines("stderr", buf.toString("utf8"));
    });

    // Hard cap at 3 minutes; if wineboot hasn't produced output for 60s, kill it.
    const hardTimeout = setTimeout(() => {
      wineBootLog.warn("hard timeout after 180s, killing");
      try { child.kill("SIGKILL"); } catch { /* noop */ }
    }, 180_000);
    const idleTimer = setInterval(() => {
      if (Date.now() - lastBytes > 60_000) {
        wineBootLog.warn("idle > 60s, killing");
        try { child.kill("SIGKILL"); } catch { /* noop */ }
        clearInterval(idleTimer);
      }
    }, 10_000);

    child.on("error", (err) => {
      clearTimeout(hardTimeout);
      clearInterval(idleTimer);
      wineBootLog.error(`spawn error: ${(err as Error).message}`);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(hardTimeout);
      clearInterval(idleTimer);
      const post = collectPrefixHealthStatus(prefix);
      wineBootLog.log(
        `close: exit=${code}  post.healthy=${post.healthy}  missing=${post.missing.length}`
      );
      if (code === 0 || post.healthy) {
        // Even if exit code isn't zero, if the prefix is now healthy the
        // init essentially succeeded — wineboot is known to exit non-zero
        // on various harmless warnings.
        resolve();
      } else {
        const tail = ring.slice(-50).join("\n");
        const msg =
          `wineboot --init 失败（退出码 ${code}）\n\n---- wineboot 输出末尾 ----\n` +
          (tail || "(wineboot 未产生任何输出，可能根本没执行到 wineboot.exe 的逻辑)");
        wineBootLog.error(msg);
        reject(new Error(msg));
      }
    });
  });

  // Wait for wineserver to stop, so winetricks won't race against a still-
  // starting prefix. `wineserver -w` blocks until everything quits.
  const wineserver = env.WINESERVER;
  if (wineserver && fs.existsSync(wineserver)) {
    try {
      await new Promise<void>((resolve) => {
        const c = spawn(wineserver, ["-w"], { env: { ...env, WINEPREFIX: prefix }, stdio: "ignore" });
        const to = setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* noop */ } resolve(); }, 30_000);
        c.on("close", () => { clearTimeout(to); resolve(); });
        c.on("error", () => { clearTimeout(to); resolve(); });
      });
    } catch {
      // best-effort
    }
  }

  // Post-init health check: if wineboot reported success but the prefix
  // still doesn't have the core DLLs, fail loudly instead of letting the
  // caller proceed into an inevitable c0000135.
  const finalHealth = collectPrefixHealthStatus(prefix);
  if (!finalHealth.healthy) {
    const detail = finalHealth.missing.join("\n  - ");
    throw new Error(
      `Wine 前缀初始化完成但仍缺少关键文件，可能是所选 Proton 不完整或磁盘空间不足：\n  - ${detail}\n\n建议重新下载 GE-Proton 后重试。`
    );
  }

  log.info("[wineboot] prefix initialized");
  emitter?.emitLog({
    level: "info",
    message: "Wine 前缀初始化完成",
    timestamp: new Date().toTimeString().slice(0, 8),
  });
}

interface DependencyDef {
  id: string;
  name: string;
  category: DependencyCategory;
  description: string;
  size_mb: number;
  required: boolean;
}

// PRD v1.7: Dependency minimization strategy — ALL deps are opt-in.
// Proton-GE already bundles corefonts/CJK rendering, vcrun, d3dx9 etc.,
// and winetricks font installs frequently fail on fresh/older prefixes due
// to WoW64 / regedit DLL issues (c0000135). Users should run WeGame first
// and only come back here when a specific error occurs.
const DEPENDENCY_DEFINITIONS: DependencyDef[] = [
  // Fonts (Proton-GE already renders CJK correctly; install only when UI shows squares)
  { id: "font-microsoft-core", name: "Microsoft Core Fonts", category: "font", description: "Arial / Times New Roman base English fonts; install only when English fonts misrender", size_mb: 8, required: false },
  { id: "font-cjk", name: "CJK Support Fonts (CJKfonts)", category: "font", description: "Chinese/Japanese/Korean fonts; Proton-GE usually renders CJK fine, install only when squares/garbled text appears", size_mb: 25, required: false },
  // On-demand (.NET — unstable on Wine, install only on explicit error)
  { id: "dotnet46", name: ".NET Framework 4.6", category: "dotnet", description: "On-demand only; .NET is unstable on Wine", size_mb: 180, required: false },
  { id: "dotnet48", name: ".NET Framework 4.8", category: "dotnet", description: "On-demand only; .NET is unstable on Wine", size_mb: 200, required: false },
  // On-demand (VC++ — Proton-GE already bundles these)
  { id: "vcpp2005", name: "Visual C++ 2005 Redistributable", category: "vcpp", description: "Proton-GE already bundles this; on-demand only", size_mb: 6, required: false },
  { id: "vcpp2008", name: "Visual C++ 2008 Redistributable", category: "vcpp", description: "Proton-GE already bundles this; on-demand only", size_mb: 9, required: false },
  { id: "vcpp2010", name: "Visual C++ 2010 Redistributable", category: "vcpp", description: "Proton-GE already bundles this; on-demand only", size_mb: 11, required: false },
  { id: "vcpp2012", name: "Visual C++ 2012 Redistributable", category: "vcpp", description: "Proton-GE already bundles this; on-demand only", size_mb: 12, required: false },
  { id: "vcpp2013", name: "Visual C++ 2013 Redistributable", category: "vcpp", description: "Proton-GE already bundles this; on-demand only", size_mb: 13, required: false },
  { id: "vcpp2015-2022", name: "Visual C++ 2015-2022 (x64)", category: "vcpp", description: "Proton-GE already bundles this; on-demand only", size_mb: 35, required: false },
  // On-demand (Browser / System / Other)
  { id: "ie8", name: "Internet Explorer 8", category: "browser", description: "On-demand only; install if WeGame embedded browser misbehaves", size_mb: 150, required: false },
  { id: "gdiplus", name: "GDI+ (gdiplus)", category: "system", description: "On-demand only; install on graphics rendering issues", size_mb: 3, required: false },
  { id: "mscoree", name: ".NET Core Runtime (mscoree)", category: "system", description: "On-demand only; install if .NET-related errors appear", size_mb: 2, required: false },
  { id: "directx9", name: "DirectX 9.0c (d3dx9)", category: "system", description: "Proton-GE already bundles this; on-demand only", size_mb: 50, required: false },
  { id: "vcrun6", name: "Visual Basic 6 Runtime (vcrun6)", category: "other", description: "On-demand only; install if legacy VB6 components fail", size_mb: 5, required: false },
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

// ---------------------------------------------------------------------------
// PRD v1.5 §4.2.2.3 — Async + cached variant
// ---------------------------------------------------------------------------
//
// The sync `checkInstalledWinetricks` above runs `winetricks list-installed`
// via `execSync`, which blocks the Electron main-process IPC queue for 2~5s
// (wine + wineserver cold start). We keep it for legacy callers but route the
// IPC handler through the async+cached path below:
//
//   - `checkInstalledWinetricksAsync` spawns winetricks as a child process
//     (non-blocking), returns a Promise<Set<string>>.
//   - Results are cached per WINEPREFIX path. Cache is invalidated explicitly
//     when state actually changes (install/reset-prefix/manual-refresh).

interface InstalledCacheEntry {
  prefixPath: string;
  installed: Set<string>;
  timestamp: number;
}

const installedCache = new Map<string, InstalledCacheEntry>();

export function invalidateDependencyCache(prefixPath?: string): void {
  if (prefixPath) {
    installedCache.delete(prefixPath);
    log.info(`[deps-cache] invalidated for prefix: ${prefixPath}`);
  } else {
    installedCache.clear();
    log.info(`[deps-cache] invalidated ALL entries`);
  }
}

function checkInstalledWinetricksAsync(
  prefixPath: string,
  config?: EnvironmentConfig
): Promise<Set<string>> {
  return new Promise((resolve) => {
    const installed = new Set<string>();

    let childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      WINEPREFIX: prefixPath,
    };
    if (config) {
      try {
        const { env } = resolveWineBackendEnv(config);
        childEnv = { ...env, WINEPREFIX: prefixPath };
      } catch {
        // Fall back to plain env; the list may be empty but that's OK.
      }
    }

    const child = spawn("winetricks", ["list-installed"], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    // Hard timeout: if winetricks hangs (e.g. wineserver cold start >15s on a
    // slow SD card), we give up and return whatever we have. The UI will
    // still be fully responsive because we never blocked the main process.
    const timeoutHandle = setTimeout(() => {
      if (finished) return;
      finished = true;
      log.warn(`[deps-cache] winetricks list-installed timed out after 20s, killing`);
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      resolve(installed);
    }, 20000);

    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);

      if (code === 0) {
        for (const line of stdout.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("Using")) {
            installed.add(trimmed);
          }
        }
        log.info(
          `[deps-cache] detected installed packages: ${[...installed].join(", ") || "(none)"}`
        );
      } else {
        log.warn(
          `[deps-cache] winetricks list-installed exited with ${code}: ${stderr.trim().slice(0, 200)}`
        );
      }
      resolve(installed);
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);
      log.warn(`[deps-cache] failed to spawn winetricks: ${err.message}`);
      resolve(installed);
    });
  });
}

/**
 * Async, cached variant used by the IPC handler. Never blocks the main
 * process; a cache hit returns synchronously-fast. Pass `forceRefresh=true`
 * from the manual "Refresh" button or from the post-install hook to bypass
 * the cache.
 */
export async function getDependencyListAsync(
  prefixPath?: string,
  config?: EnvironmentConfig,
  opts?: { forceRefresh?: boolean }
): Promise<DependencyItem[]> {
  let installed = new Set<string>();

  if (prefixPath) {
    const cached = installedCache.get(prefixPath);
    if (cached && !opts?.forceRefresh) {
      installed = cached.installed;
      log.info(`[deps-cache] HIT for ${prefixPath} (age ${Date.now() - cached.timestamp}ms)`);
    } else {
      log.info(
        `[deps-cache] MISS for ${prefixPath}${opts?.forceRefresh ? " (forced)" : ""}, querying winetricks...`
      );
      installed = await checkInstalledWinetricksAsync(prefixPath, config);
      installedCache.set(prefixPath, {
        prefixPath,
        installed,
        timestamp: Date.now(),
      });
    }
  }

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

/**
 * Legacy sync variant. Retained for backward compatibility with any caller
 * that still uses `getDependencyList(...)` directly. The IPC handler has
 * migrated to `getDependencyListAsync` (see ipc.ts).
 */
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

  // Ensure wine prefix is actually initialized (syswow64/regedit.exe present).
  // Without this, winetricks fails with c0000135 (DLL_NOT_FOUND) on the first
  // register-font step — a class of bug users would never diagnose themselves.
  try {
    await ensureWinePrefixInitialized(winePrefixPath, backendEnv, emitter);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`wineboot --init failed: ${msg}`);
    emitter.emitLog({
      level: "error",
      message: `初始化 Wine 前缀失败：${msg}`,
      timestamp: new Date().toTimeString().slice(0, 8),
    });
    emitter.emitProgress({
      current_dependency: "",
      current_step: "初始化 Wine 前缀失败",
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

  // PRD v1.4 §4.2.2.2: Pre-seed winetricks cache from domestic mirrors to
  // avoid well-known upstream failures (Microsoft CDN cert issues, web.archive
  // IPv6 unreachable, etc.). Best-effort: we never abort on pre-seed failure.
  try {
    const wtVerbs = selectedIds.map((id) => winetricksId(id));
    log.info(`[mirrors] Pre-seeding winetricks cache for: ${wtVerbs.join(", ")}`);
    emitter.emitLog({
      level: "info",
      message: "正在尝试从国内镜像源预下载依赖包（避免境外源失败）...",
      timestamp: new Date().toTimeString().slice(0, 8),
    });
    const seeded = await preseedWinetricksCache(wtVerbs);
    if (seeded.length > 0) {
      log.info(`[mirrors] Successfully pre-seeded: ${seeded.join(", ")}`);
      emitter.emitLog({
        level: "info",
        message: `已从镜像源预下载：${seeded.join(", ")}`,
        timestamp: new Date().toTimeString().slice(0, 8),
      });
    }
  } catch (err) {
    // Non-fatal — just warn and continue with the normal winetricks path.
    log.warn(`[mirrors] pre-seed stage reported error (continuing): ${err}`);
  }

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

  // PRD v1.5 §4.2.2.3: invalidate the installed-status cache so the next
  // `getDependencyListAsync` call on the frontend reflects the real state.
  invalidateDependencyCache(winePrefixPath);

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
    const childEnv: Record<string, string> = { ...backendEnv, WINEPREFIX: prefixPath };
    log.info(`[winetricks:${wtId}] spawn: winetricks -q --unattended ${wtId}`);
    log.info(`[winetricks:${wtId}]   WINEPREFIX=${childEnv.WINEPREFIX}`);
    log.info(`[winetricks:${wtId}]   W_OPT_UNATTENDED=${childEnv.W_OPT_UNATTENDED} WINETRICKS_GUI=${childEnv.WINETRICKS_GUI}`);

    const child = spawn("winetricks", ["-q", "--unattended", wtId], {
      env: childEnv,
      // Detach stdin so winetricks / zenity fallback cannot block waiting for input
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let lastActivity = Date.now();

    // Periodic heartbeat so UI does not appear frozen during long downloads
    // (e.g. dotnet46 pulls ~60MB silently before printing anything).
    const heartbeat = setInterval(() => {
      const idleSec = Math.round((Date.now() - lastActivity) / 1000);
      const now = new Date();
      const ts = now.toTimeString().slice(0, 8) + "." + String(now.getMilliseconds()).padStart(3, "0");
      const msg = `… ${wtId} still running (idle ${idleSec}s, this is normal during downloads)`;
      log.info(`[winetricks:${wtId}] ${msg}`);
      emitter.emitLog({ level: "info", message: msg, timestamp: ts });
    }, 15000);

    child.stdout?.on("data", (data: Buffer) => {
      lastActivity = Date.now();
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
      lastActivity = Date.now();
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
      clearInterval(heartbeat);
      log.info(`[winetricks:${wtId}] Process exited with code: ${code}`);
      if (code === 0) resolve(output);
      else reject(new Error(`winetricks ${wtId} failed with exit code: ${code}`));
    });

    child.on("error", (err) => {
      clearInterval(heartbeat);
      log.error(`[winetricks:${wtId}] Process error: ${err.message}`);
      reject(new Error(`Failed to run winetricks: ${err.message}`));
    });
  });
}
