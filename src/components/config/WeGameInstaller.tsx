import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Loader2,
  Package,
  RefreshCw,
  XCircle,
} from "lucide-react";
import ProgressBar from "../ProgressBar";
import {
  checkWegameInstalled,
  clearWegameInstallerCache,
  installWegame as apiInstallWegame,
  listen,
} from "../../utils/api";
import type { EnvironmentConfig } from "../../types";

export type WeGameInstallerVariant = "wizard" | "manage";
export type WeGameInstallPhase = "idle" | "download" | "install" | "done" | "error";

interface WegameInstallEvent {
  phase: WeGameInstallPhase;
  percent: number;
  message?: string;
  error?: string;
}

interface WeGameInstallerProps {
  config: EnvironmentConfig | null;
  /** "wizard"  = centered copy, big CTA, used as SetupWizard step 5.
   *  "manage"  = compact card for Dependencies page, shows status+reinstall. */
  variant?: WeGameInstallerVariant;
  /** Optional callback fired when install finishes successfully (so wizard
   *  can auto-advance / close). */
  onInstalled?: () => void;
  /** Optional: report installed-state changes back to parent. Fires on
   *  initial check and after every install/reinstall. Use this to drive
   *  wizard navigation (e.g. "Finish" vs "Install later" button copy). */
  onStatusChange?: (state: { installed: boolean | null; exePath: string | null }) => void;
}

/**
 * Shared WeGame installer UI.
 *
 * Backed by the existing install_wegame / check_wegame_installed /
 * clear_wegame_installer_cache IPC commands. Subscribes to
 * "wegame-install-progress" events for in-flight progress updates.
 */
export default function WeGameInstaller({
  config,
  variant = "manage",
  onInstalled,
  onStatusChange,
}: WeGameInstallerProps) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [exePath, setExePath] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [phase, setPhase] = useState<WeGameInstallPhase>("idle");
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Subscribe to install progress events
  useEffect(() => {
    const unsub = listen<WegameInstallEvent>("wegame-install-progress", (p) => {
      if (p.phase === "error") {
        setError(p.error || p.message || "安装失败");
        setPhase("error");
      } else {
        setPhase(p.phase);
        setError(null);
      }
      if (typeof p.percent === "number") setPercent(p.percent);
      if (p.message) setMessage(p.message);
    });
    return () => unsub();
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!config) return;
    try {
      const r = (await checkWegameInstalled(config)) as { installed: boolean; exePath?: string };
      setInstalled(r.installed);
      setExePath(r.exePath ?? null);
      onStatusChange?.({ installed: r.installed, exePath: r.exePath ?? null });
    } catch {
      setInstalled(false);
      onStatusChange?.({ installed: false, exePath: null });
    }
  }, [config, onStatusChange]);

  // Initial status check
  useEffect(() => {
    if (config && installed === null) {
      void refreshStatus();
    }
  }, [config, installed, refreshStatus]);

  async function handleInstall(forceRedownload = false) {
    if (!config) return;
    setInstalling(true);
    setError(null);
    setMessage(forceRedownload ? "准备重新下载安装器..." : "准备开始...");
    setPhase("download");
    setPercent(0);
    try {
      const res = (await apiInstallWegame(config, forceRedownload)) as {
        success: boolean;
        exePath?: string;
        error?: string;
      };
      if (res.success) {
        setInstalled(true);
        setExePath(res.exePath ?? null);
        setPhase("done");
        setPercent(100);
        setMessage(res.exePath ? `WeGame 已安装到：${res.exePath}` : "WeGame 已安装");
        onStatusChange?.({ installed: true, exePath: res.exePath ?? null });
        onInstalled?.();
      } else {
        setError(res.error || "安装失败");
        setPhase("error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
    } finally {
      setInstalling(false);
    }
  }

  async function handleReinstall() {
    try {
      await clearWegameInstallerCache(config ?? undefined);
    } catch {
      // best-effort
    }
    await handleInstall(true);
  }

  if (!config) return null;

  // ===== Wizard variant: big, centered, with heading =====
  if (variant === "wizard") {
    return (
      <div className="space-y-5">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-100">安装 WeGame</h3>
          <p className="mt-1 text-sm text-gray-400">
            最后一步：把腾讯 WeGame 本体安装到我们刚刚配置好的 Wine 环境中。
          </p>
        </div>

        {installed === null && (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-white/5 bg-white/5 p-4 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在检测当前环境中是否已安装 WeGame...
          </div>
        )}

        {installed === true && phase !== "error" && !installing && (
          <div className="rounded-lg border border-neon-green/20 bg-neon-green/5 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-neon-green" />
              <div className="flex-1">
                <h4 className="font-semibold text-neon-green">WeGame 已安装</h4>
                {exePath && (
                  <p className="mt-1 break-all text-xs text-gray-400">
                    可执行文件：<code className="text-gray-300">{exePath}</code>
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  您可以直接点击右下角「完成」结束向导，之后在「启动器」页启动 WeGame。
                </p>
                <div className="mt-3">
                  <button
                    onClick={handleReinstall}
                    disabled={installing}
                    className="neon-secondary flex items-center gap-1.5 text-xs disabled:opacity-30"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重新下载并安装（如需覆盖/升级）
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {installed === false && !installing && phase !== "done" && (
          <div className="rounded-lg border border-neon-yellow/20 bg-neon-yellow/5 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 flex-shrink-0 text-neon-yellow" />
              <div className="flex-1">
                <h4 className="font-semibold text-neon-yellow">尚未安装 WeGame</h4>
                <p className="mt-1 text-sm text-gray-300">
                  点击下方按钮，我们会自动下载腾讯官方 WeGame 安装程序，并在您配置好的 Wine 环境里运行它。
                </p>
                <ul className="mt-2 ml-4 list-disc space-y-0.5 text-xs text-gray-400">
                  <li>安装器会以图形界面弹出，请在里面完成"下一步/同意/安装"等常规步骤</li>
                  <li>安装器完成后，我们会自动校验 WeGameLauncher.exe 是否就位</li>
                  <li>下载到本地缓存（<code className="text-gray-300">~/.cache/decky-wegame/installers</code>），下次重装可跳过下载</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => handleInstall(false)}
                disabled={installing}
                className="neon-primary text-base px-8 py-3 flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                下载并安装 WeGame
              </button>
            </div>
          </div>
        )}

        {installing && (
          <div className="space-y-4 pt-2">
            <ProgressBar
              percent={percent}
              label={
                phase === "download"
                  ? "正在下载 WeGame 安装器..."
                  : phase === "install"
                  ? "正在运行 WeGame 安装器..."
                  : "处理中..."
              }
            />
            {message && (
              <div className="rounded-lg border border-white/5 bg-white/5 p-3 text-center text-xs text-gray-400">
                {message}
              </div>
            )}
            {phase === "install" && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-gray-300">
                💡 WeGame 安装向导将在桌面弹出。请点击「下一步」→「同意」→「安装」完成流程。
                如果窗口看起来没反应，请稍等十几秒等待 Wine 启动。
              </div>
            )}
          </div>
        )}

        {phase === "error" && error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-5">
            <div className="flex items-start gap-3">
              <XCircle className="h-6 w-6 flex-shrink-0 text-red-400" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-300">安装失败</h4>
                <p className="mt-1 break-words text-sm text-gray-300">{error}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleInstall(false)}
                    disabled={installing}
                    className="neon-secondary flex items-center gap-1.5 text-sm disabled:opacity-30"
                  >
                    <RefreshCw className="h-4 w-4" />
                    重试
                  </button>
                  <button
                    onClick={handleReinstall}
                    disabled={installing}
                    className="neon-secondary flex items-center gap-1.5 text-sm disabled:opacity-30"
                  >
                    <Download className="h-4 w-4" />
                    清缓存并重新下载
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {phase === "done" && installed && (
          <div className="rounded-lg border border-neon-green/20 bg-neon-green/5 p-6 text-center">
            <Check className="mx-auto mb-3 h-10 w-10 text-neon-green" />
            <h4 className="font-semibold text-neon-green">WeGame 安装完成！</h4>
            <p className="mt-1 text-sm text-gray-400">
              现在可以关闭向导，回到「启动器」页点击「启动 WeGame」。
            </p>
          </div>
        )}

        {!installing && (
          <div className="rounded-lg border border-white/5 bg-white/5 p-3 text-xs text-gray-400">
            📦 也可以选择跳过此步：如果您已手动把 WeGame 文件放在 Wine 前缀下的{" "}
            <code className="text-gray-300">drive_c/Program Files/Tencent/WeGame/</code>，
            直接点击右下角「完成」即可。
          </div>
        )}
      </div>
    );
  }

  // ===== Manage variant: compact card, used in Dependencies page =====
  return (
    <div className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <Package className="h-4.5 w-4.5 text-primary" />
          WeGame 本体
        </h3>
        <button
          onClick={refreshStatus}
          disabled={installing}
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 disabled:opacity-50"
          title="重新检测 WeGame 安装状态"
        >
          <RefreshCw className="h-3 w-3" />
          重新检测
        </button>
      </div>

      {installed === null && (
        <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-gray-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在检测安装状态...
        </div>
      )}

      {installed === true && (
        <div className="rounded-lg border border-neon-green/20 bg-neon-green/5 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-neon-green">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="font-medium">WeGame 已安装</span>
          </div>
          {exePath && (
            <p className="mt-1 ml-6 break-all text-[11px] text-gray-500 font-mono">{exePath}</p>
          )}
        </div>
      )}

      {installed === false && (
        <div className="flex items-center gap-2 rounded-lg border border-neon-yellow/20 bg-neon-yellow/5 px-4 py-2.5 text-sm text-neon-yellow">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          尚未安装 WeGame，可通过下方按钮安装。
        </div>
      )}

      {/* In-flight progress */}
      {installing && (
        <div className="space-y-2">
          <ProgressBar
            percent={percent}
            label={
              phase === "download"
                ? "正在下载 WeGame 安装器..."
                : phase === "install"
                ? "正在运行 WeGame 安装器..."
                : "处理中..."
            }
            size="md"
          />
          {message && (
            <p className="text-xs text-gray-500">{message}</p>
          )}
          {phase === "install" && (
            <p className="text-xs text-gray-400">
              💡 WeGame 安装向导将在桌面弹出，请按提示完成「下一步 → 同意 → 安装」。
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {phase === "error" && error && !installing && (
        <div className="rounded-lg border border-neon-red/20 bg-neon-red/5 px-4 py-2.5 text-sm text-neon-red">
          <div className="flex items-start gap-2">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1 break-words">{error}</div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!installing && (
        <div className="flex flex-wrap gap-2">
          {installed === false && (
            <button
              onClick={() => handleInstall(false)}
              className="neon-primary flex items-center gap-1.5 text-sm"
            >
              <Download className="h-3.5 w-3.5" />
              下载并安装 WeGame
            </button>
          )}
          {installed === true && (
            <button
              onClick={handleReinstall}
              className="neon-secondary flex items-center gap-1.5 text-sm"
              title="清缓存并重新下载安装器"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新安装 WeGame
            </button>
          )}
          {phase === "error" && (
            <button
              onClick={() => handleInstall(false)}
              className="neon-secondary flex items-center gap-1.5 text-sm"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </button>
          )}
        </div>
      )}
    </div>
  );
}
