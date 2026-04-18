import { useEffect, useRef, useState } from "react";
import { CheckCircle, Loader2, XCircle, AlertTriangle, Rocket, ArrowRight, FolderOpen, ChevronUp, ChevronDown } from "lucide-react";
import ProgressBar from "./ProgressBar";
import {
  listen,
  startAutoSetup as apiStartAutoSetup,
  cancelAutoSetup as apiCancelAutoSetup,
  pickWegameInstaller,
  installWegameFromLocal,
} from "../utils/api";
import type { EnvironmentConfig } from "../types";

/**
 * The live progress page that runs after the user picks "🚀 一键自动安装"
 * on the welcome screen (PRD §4.1.0.1).
 *
 * Contract:
 *   - Mounting the component does NOT automatically start a run; the parent
 *     wizard decides when to call `onStartRequested()` (which is wired to
 *     apiStartAutoSetup under the hood — we keep it out of this component
 *     so the parent can guard against double-clicks / already-running
 *     state).
 *   - Progress frames arrive on the "auto-setup-progress" IPC channel and
 *     are merged into local state.
 *   - Raw log lines come in on the shared "log-event" channel — we tail
 *     the last 10 but let the user expand to see the full buffer.
 *   - When the run reaches a terminal state (done / error / cancelled),
 *     the component stops reacting to new frames (except for the last
 *     degrade-hint banner) and shows the appropriate footer (success card
 *     with "Launch WeGame" CTA, or error card with the degrade-specific
 *     escape hatch).
 *
 * The "切换到高级模式 →" button in the top-right is always live (even
 * mid-run); clicking it cancels the current run cooperatively and then
 * fires onEscapeToAdvanced() so the parent can swap in the 5-step wizard
 * with state pre-filled (the caller looks at `finalConfig` / current
 * frame to decide what to pre-populate).
 */

// --- shared types (mirror of AutoSetupProgress in electron/backend/auto_setup.ts) ---

type AutoSetupStage = "proton" | "prefix" | "deps" | "wegame";

type AutoSetupStatus =
  | "running"
  | "stage-done"
  | "done"
  | "error"
  | "cancelled"
  | "needs-user";

interface AutoSetupProgress {
  runId: string;
  stage: AutoSetupStage;
  stageIndex: number;
  stageLabel: string;
  subPercent: number;
  overallPercent: number;
  message: string;
  status: AutoSetupStatus;
  elapsedMs: number;
  error?: string;
  finalConfig?: EnvironmentConfig;
  needsUser?: { kind: "wine-installer-running"; message: string };
  degrade?: {
    kind: "proton-fallback" | "deps-skipped" | "wegame-local-file";
    message: string;
  };
}

interface LogLine {
  level: string;
  message: string;
  timestamp: string;
}

// --- props ---

export interface AutoSetupScreenProps {
  /** Current environment config — passed straight into auto_setup_start. */
  config: EnvironmentConfig;
  /** User requested the top-right "切换到高级模式 →" escape hatch. Parent
   *  should cancel the run (if any) and swap in the advanced wizard,
   *  pre-filling state from `latest` if provided. */
  onEscapeToAdvanced: (latest: AutoSetupProgress | null) => void;
  /** Run finished successfully and the user clicked "启动 WeGame" on the
   *  success card. Parent should close the wizard and navigate to launcher. */
  onLaunchWegame: (finalConfig: EnvironmentConfig) => void;
  /** Run finished (done / error / cancelled). Parent may persist state. */
  onFinish?: (finalFrame: AutoSetupProgress) => void;
}

const STAGE_ORDER: AutoSetupStage[] = ["proton", "prefix", "deps", "wegame"];
const STAGE_LABELS: Record<AutoSetupStage, string> = {
  proton: "选择 Proton",
  prefix: "创建 / 修复 Wine Prefix",
  deps: "预拉取核心依赖",
  wegame: "引导安装 WeGame",
};

export default function AutoSetupScreen({
  config,
  onEscapeToAdvanced,
  onLaunchWegame,
  onFinish,
}: AutoSetupScreenProps) {
  const [frame, setFrame] = useState<AutoSetupProgress | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [elapsedTick, setElapsedTick] = useState(0); // forces re-render so "已耗时 N 秒" updates
  const [starting, setStarting] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);
  // Local file fallback busy-state for the wegame-local-file degrade footer
  const [localFileBusy, setLocalFileBusy] = useState(false);
  const [localFileError, setLocalFileError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  // Start the run exactly once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiStartAutoSetup(config);
      if (cancelled) return;
      if (!res.success || !res.runId) {
        setStartError(res.error || "后端拒绝启动自动配置");
        setStarting(false);
        return;
      }
      runIdRef.current = res.runId;
      setStarting(false);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to progress / log events.
  useEffect(() => {
    const off1 = listen<AutoSetupProgress>("auto-setup-progress", (p) => {
      setFrame(p);
      if (p.status === "done" || p.status === "error" || p.status === "cancelled") {
        onFinish?.(p);
      }
    });
    const off2 = listen<LogLine>("log-event", (l) => {
      setLogs((prev) => [...prev.slice(-499), l]);
    });
    return () => { off1(); off2(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick so elapsed time updates while a run is active.
  useEffect(() => {
    if (!frame) return;
    if (frame.status === "done" || frame.status === "error" || frame.status === "cancelled") return;
    const t = setInterval(() => setElapsedTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [frame?.status]);

  const isTerminal = frame?.status === "done" || frame?.status === "error" || frame?.status === "cancelled";
  const overall = frame?.overallPercent ?? 0;
  // Display "已耗时 N 秒": take the last frame's elapsedMs (authoritative),
  // then add a local tick counter so the number keeps counting up between
  // backend frames while the run is still live.
  const elapsed = frame ? Math.floor(frame.elapsedMs / 1000) + (isTerminal ? 0 : elapsedTick) : 0;

  // --- user actions ---

  async function handleEscape(): Promise<void> {
    if (runIdRef.current && !isTerminal) {
      try { await apiCancelAutoSetup(runIdRef.current); } catch { /* noop */ }
    }
    onEscapeToAdvanced(frame);
  }

  async function handlePickLocalFile(): Promise<void> {
    setLocalFileError(null);
    setLocalFileBusy(true);
    try {
      const picked = await pickWegameInstaller();
      if (picked.canceled || !picked.filePath) {
        setLocalFileBusy(false);
        return;
      }
      const res = (await installWegameFromLocal(config, picked.filePath)) as { success: boolean; exePath?: string; error?: string };
      if (res.success) {
        // Fabricate a terminal "done" frame so the success card renders.
        const cfgWithWegame: EnvironmentConfig = res.exePath
          ? { ...config, wegame_install_path: res.exePath.replace(/[/\\][^/\\]+$/, "") }
          : config;
        setFrame({
          runId: runIdRef.current || "local-file",
          stage: "wegame",
          stageIndex: 3,
          stageLabel: STAGE_LABELS.wegame,
          subPercent: 100,
          overallPercent: 100,
          message: "已通过本地文件完成 WeGame 安装",
          status: "done",
          elapsedMs: frame?.elapsedMs ?? 0,
          finalConfig: cfgWithWegame,
        });
      } else {
        setLocalFileError(res.error || "本地安装失败");
      }
    } catch (err) {
      setLocalFileError((err as Error).message);
    } finally {
      setLocalFileBusy(false);
    }
  }

  // --- render ---

  return (
    <div className="relative flex flex-col min-h-[540px]">
      {/* Top-right always-visible escape hatch (PRD §4.1.0.1 中途逃生) */}
      <button
        onClick={handleEscape}
        className="absolute right-0 top-0 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-gray-400 hover:bg-white/5 hover:text-gray-200 hover:border-white/20 transition-colors"
      >
        <span>切换到高级模式</span>
        <ArrowRight size={14} />
      </button>

      <div className="mb-6 pr-40">
        <h2 className="text-xl font-semibold text-white mb-1">自动配置中...</h2>
        <p className="text-xs text-gray-500">
          所有步骤均通过镜像池自动降级；任何一步失败会在下方给出下一步操作。
        </p>
      </div>

      {/* Stage summary row */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        {STAGE_ORDER.map((id, idx) => {
          const isActive = frame?.stageIndex === idx && !isTerminal;
          const isDone =
            (frame && frame.stageIndex > idx) ||
            (frame?.stageIndex === idx && frame.status === "stage-done") ||
            (frame?.status === "done");
          const isFailed = frame?.stageIndex === idx && frame.status === "error";
          return (
            <div
              key={id}
              className={`rounded-lg border px-3 py-2 transition-colors ${
                isFailed
                  ? "border-red-500/40 bg-red-500/5"
                  : isDone
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : isActive
                      ? "border-primary/50 bg-primary/5"
                      : "border-white/5 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {isFailed ? (
                  <XCircle size={14} className="text-red-400" />
                ) : isDone ? (
                  <CheckCircle size={14} className="text-emerald-400" />
                ) : isActive ? (
                  <Loader2 size={14} className="animate-spin text-primary" />
                ) : (
                  <div className="h-3.5 w-3.5 rounded-full border border-white/20" />
                )}
                <span className="text-[10px] font-mono text-gray-500">{idx + 1}/4</span>
              </div>
              <div
                className={`mt-1 text-xs font-medium ${
                  isFailed
                    ? "text-red-300"
                    : isDone
                      ? "text-emerald-300"
                      : isActive
                        ? "text-white"
                        : "text-gray-500"
                }`}
              >
                {STAGE_LABELS[id]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall progress bar (top fixed per PRD) */}
      <div className="mb-2">
        <ProgressBar
          percent={overall}
          label={`整体进度 · ${frame?.stageIndex !== undefined ? frame.stageIndex + 1 : 1}/4 · 已耗时 ${elapsed}s`}
          size="md"
        />
      </div>

      {/* Current stage mid-section */}
      <div className="mt-4 rounded-lg border border-white/10 bg-surface-dark/60 p-4">
        {starting ? (
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Loader2 size={16} className="animate-spin text-primary" />
            <span>正在启动自动配置流程...</span>
          </div>
        ) : startError ? (
          <div className="flex items-start gap-2 text-sm text-red-300">
            <XCircle size={16} className="mt-0.5 text-red-400" />
            <div>
              <div>启动失败：{startError}</div>
              <button
                onClick={handleEscape}
                className="mt-2 text-xs text-primary hover:underline"
              >
                切换到高级模式手动配置 →
              </button>
            </div>
          </div>
        ) : frame ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-white">
                {frame.stageLabel}
              </div>
              <div className="text-xs font-mono text-gray-500">
                {frame.subPercent.toFixed(0)}%
              </div>
            </div>
            <ProgressBar percent={frame.subPercent} showPercent={false} size="sm" />
            <div className="mt-3 flex items-start gap-2 text-xs text-gray-300">
              {frame.status === "needs-user" ? (
                <AlertTriangle size={14} className="mt-0.5 text-amber-400 flex-shrink-0" />
              ) : frame.status === "error" ? (
                <XCircle size={14} className="mt-0.5 text-red-400 flex-shrink-0" />
              ) : frame.status === "cancelled" ? (
                <XCircle size={14} className="mt-0.5 text-gray-400 flex-shrink-0" />
              ) : (
                <Loader2 size={14} className="mt-0.5 animate-spin text-primary flex-shrink-0" />
              )}
              <div className="flex-1">
                <div>{frame.message}</div>
                {frame.needsUser?.kind === "wine-installer-running" && (
                  <div className="mt-1 text-[11px] text-amber-300/80">
                    💡 Wine 已弹出 WeGame 原生安装向导 — 请在该窗口中点击 "下一步 / 安装 / 完成"，安装完后本页面会自动继续。
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-400">等待后端首个进度帧...</div>
        )}
      </div>

      {/* Log tail (last 10, expandable) */}
      <div className="mt-4 rounded-lg border border-white/5 bg-surface-dark/40">
        <button
          onClick={() => setLogsExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs text-gray-400 hover:bg-white/[0.02] transition-colors"
        >
          <span>日志（{logs.length} 行，最近 10 行如下）</span>
          {logsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="max-h-[200px] overflow-y-auto px-3 pb-3">
          <pre className="text-[11px] leading-relaxed font-mono text-gray-400 whitespace-pre-wrap">
            {(logsExpanded ? logs : logs.slice(-10))
              .map((l) => `[${l.timestamp}] ${l.level.toUpperCase().padEnd(5)} ${l.message}`)
              .join("\n") || "(暂无日志)"}
          </pre>
        </div>
      </div>

      {/* Footer — terminal state cards */}
      {frame?.status === "done" && (
        <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle size={22} className="text-emerald-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-base font-semibold text-white">准备完成</div>
              <div className="mt-1 text-sm text-gray-300">
                {frame.message}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                可在「依赖管理」页进一步微调（安装可选依赖、查看诊断等）。
              </div>
              <button
                onClick={() => onLaunchWegame(frame.finalConfig ?? config)}
                className="mt-4 flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:shadow-primary/40 transition-all hover:scale-[1.02]"
              >
                <Rocket size={16} />
                <span>启动 WeGame</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {frame?.status === "error" && (
        <div className="mt-5 rounded-xl border border-red-500/40 bg-red-500/5 p-5">
          <div className="flex items-start gap-3">
            <XCircle size={22} className="text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-base font-semibold text-white">
                {frame.stageLabel}阶段失败
              </div>
              <div className="mt-1 text-sm text-red-200">{frame.message}</div>
              {frame.degrade && (
                <div className="mt-2 text-xs text-amber-200/80">
                  💡 {frame.degrade.message}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {frame.degrade?.kind === "wegame-local-file" && (
                  <button
                    onClick={handlePickLocalFile}
                    disabled={localFileBusy}
                    className="flex items-center gap-2 rounded-lg bg-primary/80 px-4 py-2 text-xs font-medium text-white hover:bg-primary transition-colors disabled:opacity-50"
                  >
                    <FolderOpen size={14} />
                    <span>{localFileBusy ? "安装中..." : "选择本地安装器文件"}</span>
                  </button>
                )}
                <button
                  onClick={handleEscape}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                >
                  <span>切换到高级模式手动处理</span>
                  <ArrowRight size={14} />
                </button>
              </div>
              {localFileError && (
                <div className="mt-2 text-xs text-red-300">{localFileError}</div>
              )}
              {frame.error && (
                <details className="mt-3 text-[11px] text-gray-500">
                  <summary className="cursor-pointer">查看完整错误详情</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-gray-400">
                    {frame.error}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {frame?.status === "cancelled" && (
        <div className="mt-5 rounded-xl border border-gray-500/30 bg-white/[0.02] p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={22} className="text-gray-400 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-base font-semibold text-gray-200">自动配置已取消</div>
              <div className="mt-1 text-sm text-gray-400">
                目前已完成的状态（已选 Proton 等）会被带到高级模式继续。
              </div>
              <button
                onClick={handleEscape}
                className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                <span>进入高级模式</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
