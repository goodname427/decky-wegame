/**
 * Auto-setup orchestrator (PRD §4.1.0.1).
 *
 * Runs four sequential stages that together take a fresh install from
 * "nothing configured" to "WeGame launched":
 *
 *   1. proton  — pick a Proton (prefer Valve official if present, else use
 *                any existing GE-Proton, else download the latest GE-Proton
 *                through the mirror pool)
 *   2. prefix  — create / repair the Wine prefix via ensureWinePrefixInitialized
 *   3. deps    — best-effort pre-seed the winetricks cache (does NOT install
 *                dependencies; see PRD §4.1.1 "dependency minimization")
 *   4. wegame  — download + run the WeGame installer (L1/L2/L3 per §4.1.1.5)
 *
 * Design notes:
 *   - Progress is emitted on a dedicated channel ("auto-setup-progress")
 *     distinct from the advanced-wizard's "install-progress" channel, so
 *     the two flows can never contaminate each other's UI.
 *   - Raw log lines are forwarded through the shared "log-event" channel,
 *     which is what useInstallProgress() already subscribes to — the
 *     AutoSetupScreen can reuse the same 10-line tail UI for free.
 *   - Cancellation is cooperative: each stage boundary (and the download
 *     progress callback inside stage 1 / 4) consults the run's abort flag
 *     and bails out with status="cancelled" on the next tick.
 *   - Failure degrades gracefully: every stage knows its own "how does the
 *     user fix this from advanced mode" hint and packages it in `degrade`
 *     so the UI can render a one-click escape hatch instead of a stack
 *     trace (PRD §1 P0 rule 4 "errors must give the next step").
 */

import { EnvironmentConfig, LogPayload, ProtonInfo } from "./types";
import { scanProtonVersions } from "./proton";
import {
  ensureWinePrefixInitialized,
  resolveWineBackendEnv,
} from "./dependencies";
import { getPrefixPath, expandPath } from "./environment";
import { saveConfig } from "./config";
import { downloadAndInstallGeProton } from "./middleware";
import {
  downloadAndInstallWegame,
  isWegameInstalled,
  killRunningInstaller,
} from "./wegame_installer";
import { preseedWinetricksCache } from "./mirrors";
import { runDiagnostics, type DiagnosticReport } from "./diagnostics";
import { Log } from "./logger";

const log = Log.category("AutoSetup");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AutoSetupStage = "proton" | "prefix" | "deps" | "wegame";

export type AutoSetupStatus =
  | "running"
  | "stage-done"
  | "done"
  | "error"
  | "cancelled"
  | "needs-user";

export interface AutoSetupProgress {
  runId: string;
  stage: AutoSetupStage;
  /** 0-based index in STAGES (for rendering "X/4"). */
  stageIndex: number;
  /** Human-readable Chinese label of the current stage. */
  stageLabel: string;
  /** 0-100 progress within the current stage. */
  subPercent: number;
  /** 0-100 overall progress across all four stages. */
  overallPercent: number;
  /** One-line status message shown under the stage label. */
  message: string;
  status: AutoSetupStatus;
  /** Milliseconds since the run started (UI converts to "已耗时 N 秒"). */
  elapsedMs: number;
  /** Populated when status === "error". */
  error?: string;
  /** Populated when status === "done" so the UI can update its cached env. */
  finalConfig?: EnvironmentConfig;
  /** Stage-specific "waiting on the user" sub-state (e.g. Wine GUI is up). */
  needsUser?: { kind: "wine-installer-running"; message: string };
  /**
   * Graceful-degradation hint surfaced alongside an error / stage-done, so
   * the UI can render a single-click escape hatch (e.g. "pick a local
   * installer file" when the online mirrors are all down).
   */
  degrade?: {
    kind: "proton-fallback" | "deps-skipped" | "wegame-local-file";
    message: string;
  };
  /**
   * When stage 4 (WeGame install) fails, we automatically run the network /
   * prefix diagnostics once and attach the report here, so the error card
   * can show the user which hostnames were unreachable without them having
   * to navigate to the dependencies page and click the diagnose button.
   * Populated only on terminal error frames from the WeGame stage.
   */
  diagnosticReport?: DiagnosticReport;
}

export interface AutoSetupStartResult {
  runId: string;
}

export interface AutoSetupCancelResult {
  cancelled: boolean;
}

// ---------------------------------------------------------------------------
// Stage metadata
// ---------------------------------------------------------------------------

const STAGES: { id: AutoSetupStage; label: string }[] = [
  { id: "proton", label: "选择 Proton" },
  { id: "prefix", label: "创建 / 修复 Wine Prefix" },
  { id: "deps", label: "预拉取核心依赖" },
  { id: "wegame", label: "引导安装 WeGame" },
];

// ---------------------------------------------------------------------------
// Run-state singleton (only one auto-setup at a time)
// ---------------------------------------------------------------------------

interface RunState {
  runId: string;
  startedAt: number;
  cancelRequested: boolean;
  // Bumped via `config` mutations during the run (e.g. proton_path gets
  // written after stage 1). We hand this back to the UI on "done".
  workingConfig: EnvironmentConfig;
}

let currentRun: RunState | null = null;

export function isAutoSetupRunning(): boolean {
  return currentRun !== null;
}

export function requestAutoSetupCancel(runId: string): AutoSetupCancelResult {
  if (!currentRun || currentRun.runId !== runId) {
    return { cancelled: false };
  }
  currentRun.cancelRequested = true;
  log.warn(`${runId}: cancel requested`);
  // If we're currently in stage 4 with a Wine installer GUI up, the user
  // pressing cancel should tear that subtree down right away — otherwise
  // the installer can linger for 1-2 minutes while we sit on the next
  // stage boundary check, which looks like the cancel button is broken.
  // killRunningInstaller is a no-op if there's no installer running, so
  // it's safe to call unconditionally here.
  try {
    killRunningInstaller();
  } catch (err) {
    log.warn(`${runId}: killRunningInstaller threw: ${(err as Error).message}`);
  }
  return { cancelled: true };
}

function newRunId(): string {
  return `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface AutoSetupEmitter {
  emitProgress: (p: AutoSetupProgress) => void;
  emitLog: (l: LogPayload) => void;
}

/**
 * Kick off a new auto-setup run. Returns immediately with the runId; all
 * further progress is emitted through `emitter`. Throws synchronously iff
 * another run is already in flight.
 */
export function startAutoSetup(
  initialConfig: EnvironmentConfig,
  emitter: AutoSetupEmitter
): AutoSetupStartResult {
  if (currentRun) {
    throw new Error(
      `自动配置已在进行中 (runId=${currentRun.runId})，请勿重复触发`
    );
  }
  const runId = newRunId();
  const state: RunState = {
    runId,
    startedAt: Date.now(),
    cancelRequested: false,
    // Shallow-clone so stage mutations don't alias whatever the IPC layer
    // passed in.
    workingConfig: { ...initialConfig, extra_env_vars: { ...initialConfig.extra_env_vars } },
  };
  currentRun = state;
  log.log(`${runId}: started`);

  // Fire and forget; runLoop resolves by clearing currentRun + emitting
  // the terminal progress frame.
  runLoop(state, emitter).catch((err) => {
    // Defensive net — runLoop should already have emitted error itself.
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`${runId}: uncaught runLoop error: ${msg}`);
    emitter.emitProgress(
      finalFrame(state, {
        stage: "wegame",
        status: "error",
        message: `内部错误：${msg}`,
        error: msg,
      })
    );
  }).finally(() => {
    if (currentRun?.runId === runId) currentRun = null;
  });

  return { runId };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runLoop(state: RunState, emitter: AutoSetupEmitter): Promise<void> {
  // Stage 1: Proton
  if (await checkCancelled(state, emitter, "proton")) return;
  const stage1 = await stageProton(state, emitter);
  if (!stage1.ok) {
    emitter.emitProgress(
      finalFrame(state, {
        stage: "proton",
        status: "error",
        message: stage1.message,
        error: stage1.error,
        degrade: { kind: "proton-fallback", message: "请在高级模式中手动选择 Proton 或尝试其它镜像" },
      })
    );
    return;
  }

  // Stage 2: Prefix
  if (await checkCancelled(state, emitter, "prefix")) return;
  const stage2 = await stagePrefix(state, emitter);
  if (!stage2.ok) {
    emitter.emitProgress(
      finalFrame(state, {
        stage: "prefix",
        status: "error",
        message: stage2.message,
        error: stage2.error,
      })
    );
    return;
  }

  // Stage 3: Deps pre-seed (best-effort — never fatal)
  if (await checkCancelled(state, emitter, "deps")) return;
  const stage3 = await stageDeps(state, emitter);
  // stage3 is intentionally not failable; we just surface what it did.
  if (stage3.degraded) {
    emitter.emitLog({
      level: "warn",
      message: stage3.degraded,
      timestamp: nowHms(),
    });
  }

  // Stage 4: WeGame
  if (await checkCancelled(state, emitter, "wegame")) return;
  const stage4 = await stageWegame(state, emitter);
  if (!stage4.ok) {
    emitter.emitProgress(
      finalFrame(state, {
        stage: "wegame",
        status: "error",
        message: stage4.message,
        error: stage4.error,
        degrade: stage4.degrade,
        diagnosticReport: stage4.diagnosticReport,
      })
    );
    return;
  }

  // All four stages succeeded — persist and announce.
  try {
    saveConfig(state.workingConfig);
  } catch (err) {
    log.warn(`${state.runId}: saveConfig after success failed: ${(err as Error).message}`);
    // non-fatal; the user already sees WeGame installed
  }
  emitter.emitProgress(
    finalFrame(state, {
      stage: "wegame",
      status: "done",
      message: "准备完成，可在依赖管理页进一步微调",
      finalConfig: state.workingConfig,
    })
  );
  log.log(`${state.runId}: done in ${Date.now() - state.startedAt}ms`);
}

// ---------------------------------------------------------------------------
// Stage 1 — Proton
// ---------------------------------------------------------------------------

interface StageResult {
  ok: boolean;
  message: string;
  error?: string;
  degrade?: AutoSetupProgress["degrade"];
  /** Stage-4 only: attached when we've already auto-run diagnostics for the
   *  UI so runLoop can splice it into finalFrame without running a second
   *  diagnosis. */
  diagnosticReport?: DiagnosticReport;
}

async function stageProton(
  state: RunState,
  emitter: AutoSetupEmitter
): Promise<StageResult> {
  const announce = (subPercent: number, message: string): void => {
    emitProgress(state, emitter, "proton", subPercent, message, "running");
  };

  announce(0, "扫描已安装的 Proton...");
  let versions: ProtonInfo[] = [];
  try {
    versions = scanProtonVersions();
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, message: `Proton 扫描失败：${msg}`, error: msg };
  }

  // Policy: prefer Valve official Proton (bucket 1 in scanProtonVersions
  // ordering), else any existing GE-Proton (bucket 0), else download GE.
  const valve = versions.find((v) => !v.is_recommended && /^Proton([\s-]|$)/i.test(v.name));
  const geExisting = versions.find((v) => v.is_recommended);

  let picked: ProtonInfo | null = null;
  if (valve) {
    picked = valve;
    announce(100, `已选中 Valve 官方 Proton：${valve.name}`);
    emitter.emitLog({
      level: "info",
      message: `自动模式选择了 Valve 官方 Proton：${valve.name}`,
      timestamp: nowHms(),
    });
  } else if (geExisting) {
    picked = geExisting;
    announce(100, `已选中已安装的 GE-Proton：${geExisting.name}`);
    emitter.emitLog({
      level: "info",
      message: `自动模式选择了已安装的 GE-Proton：${geExisting.name}`,
      timestamp: nowHms(),
    });
  } else {
    // Download GE-Proton latest via the mirror pool.
    announce(5, "未检测到已安装的 Proton，准备从镜像池下载 GE-Proton...");
    emitter.emitLog({
      level: "info",
      message: "未检测到已安装的 Proton，将从镜像池下载最新 GE-Proton（大小约 300-400 MB）",
      timestamp: nowHms(),
    });

    const dl = await downloadAndInstallGeProton((p) => {
      if (state.cancelRequested) return;
      // map 0-100 of download into 5-90 of stage
      const phaseBase = p.phase === "download" ? 5 : p.phase === "extract" ? 90 : 95;
      const sub = p.phase === "download"
        ? phaseBase + Math.round(p.percent * 0.85)
        : p.phase === "extract"
          ? 92
          : 98;
      announce(Math.min(99, sub), p.message || `下载 GE-Proton ${p.percent}%`);
    });
    if (!dl.success) {
      const msg = dl.error || "未知错误";
      return {
        ok: false,
        message: `GE-Proton 下载失败：${msg}`,
        error: msg,
        degrade: {
          kind: "proton-fallback",
          message: "所有镜像均不可达；请在高级模式中手动指定 Proton 路径或检查网络后再试",
        },
      };
    }
    // Re-scan to find the freshly installed GE-Proton.
    versions = scanProtonVersions();
    picked = versions.find((v) => v.is_recommended) ?? null;
    if (!picked) {
      return {
        ok: false,
        message: "下载 GE-Proton 成功但扫描不到，疑似解压到了意外位置",
        error: "scan after install returned no GE entry",
      };
    }
    announce(100, `GE-Proton 安装完成：${picked.name}`);
  }

  state.workingConfig.proton_path = picked.path;
  emitProgress(state, emitter, "proton", 100, `Proton: ${picked.name}`, "stage-done");
  return { ok: true, message: "done" };
}

// ---------------------------------------------------------------------------
// Stage 2 — Prefix init / repair
// ---------------------------------------------------------------------------

async function stagePrefix(
  state: RunState,
  emitter: AutoSetupEmitter
): Promise<StageResult> {
  emitProgress(state, emitter, "prefix", 0, "准备初始化 Wine Prefix...", "running");
  const prefixPath = getPrefixPath(state.workingConfig);

  let env: Record<string, string>;
  try {
    const resolved = resolveWineBackendEnv(state.workingConfig);
    env = resolved.env;
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, message: `无法解析 Wine 后端：${msg}`, error: msg };
  }
  env.WINEPREFIX = prefixPath;

  try {
    emitProgress(state, emitter, "prefix", 20, `初始化 ${prefixPath}...`, "running");
    await ensureWinePrefixInitialized(prefixPath, env, {
      emitLog: (l) => emitter.emitLog(l),
    });
    emitProgress(state, emitter, "prefix", 100, "Wine Prefix 准备就绪", "stage-done");
    return { ok: true, message: "done" };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, message: `Wine Prefix 初始化失败：${msg.split("\n")[0]}`, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — winetricks cache pre-seed (best-effort, PRD §5.6.3)
// ---------------------------------------------------------------------------

async function stageDeps(
  state: RunState,
  emitter: AutoSetupEmitter
): Promise<{ degraded?: string }> {
  emitProgress(state, emitter, "deps", 0, "预热 winetricks 缓存（best-effort）...", "running");

  // Per the "dependency minimization" rule from PRD §4.1.1, stage 3 does NOT
  // auto-install any dependencies — the default is "all unchecked, install
  // on demand". We only pre-seed the winetricks on-disk cache for verbs
  // whose mirror manifest has known-good sources, so that if the user DOES
  // later try to install dotnet46 / corefonts / ... from the dependencies
  // page, the files are already local and they skip the slow / geo-restricted
  // winetricks fetch.
  //
  // With the current manifest (mirror-manifest.json), only dotnet46 is
  // registered and its `sources` array is intentionally empty, which means
  // preseedWinetricksCache will return [] after logging a "no mirrors
  // configured" verbose line. That's fine — this stage is best-effort.
  const targetVerbs = ["dotnet46"];

  let seeded: string[] = [];
  try {
    seeded = await preseedWinetricksCache(targetVerbs, { timeoutMs: 60_000 });
  } catch (err) {
    const msg = (err as Error).message;
    log.warn(`${state.runId}: preseed threw: ${msg}`);
    emitProgress(state, emitter, "deps", 100, `预热跳过（${msg}）`, "stage-done");
    return { degraded: `winetricks 缓存预热失败，已跳过：${msg}` };
  }

  const summary =
    seeded.length > 0
      ? `已预热 ${seeded.length} 个 verb：${seeded.join(", ")}`
      : "暂无 verb 需要预热（镜像清单里所有条目都没有可达源，将来手动安装时走 winetricks 原生路径）";
  emitter.emitLog({ level: "info", message: `[AutoSetup] ${summary}`, timestamp: nowHms() });
  emitProgress(state, emitter, "deps", 100, summary, "stage-done");
  return {};
}

// ---------------------------------------------------------------------------
// Stage 4 — WeGame install (PRD §4.1.1.5 three-layer fallback)
// ---------------------------------------------------------------------------

async function stageWegame(
  state: RunState,
  emitter: AutoSetupEmitter
): Promise<StageResult> {
  // Skip entirely if already installed.
  const check = isWegameInstalled(state.workingConfig);
  if (check.installed) {
    emitProgress(
      state,
      emitter,
      "wegame",
      100,
      `WeGame 已安装：${check.exePath}`,
      "stage-done"
    );
    return { ok: true, message: "already installed" };
  }

  emitProgress(state, emitter, "wegame", 0, "准备下载 WeGame 安装器...", "running");

  // downloadAndInstallWegame combines download + run; the "install" phase
  // spawns the Wine GUI installer. We forward its phase + percent into our
  // own progress frames so the user sees sub-percent even though most of
  // the "install" time is really them clicking through the Windows GUI.
  let sawInstallerGui = false;
  const result = await downloadAndInstallWegame(
    state.workingConfig,
    {},
    (p) => {
      if (state.cancelRequested) return;
      if (p.phase === "download") {
        emitProgress(state, emitter, "wegame", Math.min(60, Math.round(p.percent * 0.6)), p.message || `下载中 ${p.percent}%`, "running");
      } else if (p.phase === "install") {
        if (!sawInstallerGui) {
          sawInstallerGui = true;
          emitter.emitLog({
            level: "info",
            message: "[AutoSetup] WeGame 安装器窗口已启动 — 请在 Wine 弹出的原生安装向导中完成安装",
            timestamp: nowHms(),
          });
        }
        emitProgress(
          state,
          emitter,
          "wegame",
          Math.min(95, 60 + Math.round(p.percent * 0.35)),
          p.message || "请在 Wine 窗口中完成安装向导...",
          "needs-user",
          { needsUser: { kind: "wine-installer-running", message: "请在 Wine 弹出的 WeGame 安装向导中完成安装" } }
        );
      } else if (p.phase === "done") {
        emitProgress(state, emitter, "wegame", 98, p.message || "安装器已退出，正在验证...", "running");
      } else if (p.phase === "error") {
        // Handled below by the returned result
      }
    }
  );

  if (!result.success) {
    const msg = result.error || "未知错误";
    // Two failure shapes we care about for the degrade hint:
    //   1. mirror pool exhausted before installer even ran — detected by
    //      error text pattern (download layer doesn't set needsLocalFile)
    //   2. installer ran, exited code 0, but no WeGameLauncher.exe in prefix
    //      — surfaced explicitly as result.needsLocalFile = true (set by
    //      runWegameInstaller). This is the "Tencent CDN stalled" case.
    // Both map to the same UX: offer "pick a local installer file".
    const looksLikeAllSources404 = /候选下载源均不可用|all.*sources|all.*mirrors|均不可用/i.test(msg);
    const offerLocalFile = looksLikeAllSources404 || result.needsLocalFile === true;

    // Auto-run a diagnostic pass so the error card can tell the user *why*
    // (HTTPS blocked? DNS broken? no Proton?) without forcing them to
    // navigate elsewhere. Diagnostics is best-effort — any failure here
    // just means the card won't show the report section.
    let diagnosticReport: DiagnosticReport | undefined;
    try {
      emitter.emitLog({
        level: "info",
        message: "[AutoSetup] WeGame 安装失败，自动运行网络 / 环境诊断以定位根因...",
        timestamp: nowHms(),
      });
      diagnosticReport = await runDiagnostics(state.workingConfig);
      const worstList = diagnosticReport.results
        .filter((r) => r.status === "fail" || r.status === "warn")
        .map((r) => `${r.status.toUpperCase()} ${r.id}: ${r.message}`);
      if (worstList.length > 0) {
        emitter.emitLog({
          level: "warn",
          message: `[AutoSetup] 诊断发现问题项：${worstList.join(" | ")}`,
          timestamp: nowHms(),
        });
      }
    } catch (err) {
      log.warn(`${state.runId}: diagnostics after wegame failure threw: ${(err as Error).message}`);
    }

    return {
      ok: false,
      message: offerLocalFile
        ? "WeGame 在线安装未能完成，建议改用本地安装器文件"
        : `WeGame 安装失败：${msg.split("\n")[0]}`,
      error: msg,
      degrade: offerLocalFile
        ? {
            kind: "wegame-local-file",
            message: "点击下方「选择本地安装器文件」，从官网手动下载 WeGameSetup.exe 后导入",
          }
        : undefined,
      diagnosticReport,
    };
  }

  if (result.exePath) {
    state.workingConfig.wegame_install_path = expandPath(
      // path.dirname equivalent without importing path here — exePath points
      // at the WeGameLauncher.exe which lives in the install dir directly.
      result.exePath.replace(/[/\\][^/\\]+$/, "")
    );
  }
  emitProgress(state, emitter, "wegame", 100, "WeGame 安装完成", "stage-done");
  return { ok: true, message: "installed" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitProgress(
  state: RunState,
  emitter: AutoSetupEmitter,
  stage: AutoSetupStage,
  subPercent: number,
  message: string,
  status: AutoSetupStatus,
  extras?: Partial<AutoSetupProgress>
): void {
  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const stageLabel = STAGES[stageIndex]?.label ?? stage;
  const clampedSub = Math.max(0, Math.min(100, subPercent));
  // Each stage occupies an equal 25% slice of the overall progress bar.
  const overallPercent = Math.round(stageIndex * 25 + clampedSub * 0.25);
  emitter.emitProgress({
    runId: state.runId,
    stage,
    stageIndex,
    stageLabel,
    subPercent: clampedSub,
    overallPercent,
    message,
    status,
    elapsedMs: Date.now() - state.startedAt,
    ...extras,
  });
}

function finalFrame(
  state: RunState,
  part: Pick<AutoSetupProgress, "stage" | "status" | "message"> &
    Partial<Pick<AutoSetupProgress, "error" | "finalConfig" | "degrade" | "needsUser" | "diagnosticReport">>
): AutoSetupProgress {
  const stageIndex = STAGES.findIndex((s) => s.id === part.stage);
  return {
    runId: state.runId,
    stage: part.stage,
    stageIndex,
    stageLabel: STAGES[stageIndex]?.label ?? part.stage,
    subPercent: part.status === "done" ? 100 : 0,
    overallPercent: part.status === "done" ? 100 : Math.round(stageIndex * 25),
    message: part.message,
    status: part.status,
    elapsedMs: Date.now() - state.startedAt,
    error: part.error,
    finalConfig: part.finalConfig,
    degrade: part.degrade,
    needsUser: part.needsUser,
    diagnosticReport: part.diagnosticReport,
  };
}

async function checkCancelled(
  state: RunState,
  emitter: AutoSetupEmitter,
  upcomingStage: AutoSetupStage
): Promise<boolean> {
  if (!state.cancelRequested) return false;
  emitter.emitProgress(
    finalFrame(state, {
      stage: upcomingStage,
      status: "cancelled",
      message: "自动配置已被用户取消",
    })
  );
  log.log(`${state.runId}: cancelled at stage=${upcomingStage}`);
  return true;
}

function nowHms(): string {
  return new Date().toTimeString().slice(0, 8);
}
