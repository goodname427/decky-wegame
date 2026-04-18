import { useState, useEffect, useCallback } from "react";
import { invoke, listen } from "../utils/api";
import {
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Wand2,
  Layers,
  ExternalLink,
  Copy,
  Check,
  Save,
  Activity,
} from "lucide-react";
import ProgressBar from "../components/ProgressBar";
import LogViewer from "../components/LogViewer";
import ConfirmDialog from "../components/ConfirmDialog";
import DiagnosticsPanel from "../components/DiagnosticsPanel";
import PathsSection from "../components/config/PathsSection";
import ProtonPicker from "../components/config/ProtonPicker";
import WeGameInstaller from "../components/config/WeGameInstaller";
import { useEnvironment } from "../hooks/useEnvironment";
import { useInstallProgress } from "../hooks/useInstallProgress";
import { DEPENDENCY_LIST } from "../utils/constants";
import type {
  DependencyItem,
  DependencyCategory,
  DependencyScanResult,
  ScannedPath,
  MiddlewareDownloadProgress,
} from "../types";

const CATEGORY_LABELS: Record<DependencyCategory, string> = {
  dotnet: ".NET Framework",
  vcpp: "Visual C++ 运行时",
  font: "字体支持",
  browser: "浏览器组件",
  system: "系统组件",
  other: "其他组件",
};

// fallback 列表直接复用 constants.ts 中的 DEPENDENCY_LIST
// （单一事实来源，避免前端多处维护同一份依赖元数据导致的不一致）
const ALL_DEPS = DEPENDENCY_LIST;

type FilterType = "all" | "installed" | "missing";

interface DependenciesProps {
  onOpenSetupWizard?: () => void;
}

export default function Dependencies({ onOpenSetupWizard }: DependenciesProps) {
  const { config, saveEnvironment } = useEnvironment();
  const { progress, logs } = useInstallProgress();
  // §4.2.2.3: render placeholder (installed=false) immediately so the
  // page is interactive in <50ms even on a cold first visit. The real
  // installed-state is fetched asynchronously and merged in when ready.
  const [deps, setDeps] = useState<DependencyItem[]>(ALL_DEPS.map((d) => ({ ...d, installed: false })));
  const [filter, setFilter] = useState<FilterType>("all");
  const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);
  const [showResetPrefixConfirm, setShowResetPrefixConfirm] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [loadingDeps, setLoadingDeps] = useState(false);

  // `force=true` bypasses the backend cache (wired to the "刷新状态" button).
  const fetchDeps = useCallback(async (force: boolean = false) => {
    setLoadingDeps(true);
    try {
      const channel = force ? "refresh_dependency_list" : "get_dependency_list";
      const result: DependencyItem[] = await invoke(channel, { config });
      setDeps(result);
    } catch (err) {
      console.error("Failed to fetch dependency list:", err);
    } finally {
      setLoadingDeps(false);
    }
  }, [config]);

  useEffect(() => {
    fetchDeps(false);
  }, [fetchDeps]);

  useEffect(() => {
    if (progress.status === "completed" || progress.status === "error") {
      // Backend already invalidated its cache at this point (see
      // invalidateDependencyCache in installDependencies), so a plain fetch is
      // enough to get fresh data.
      fetchDeps(false);
    }
  }, [progress.status, fetchDeps]);

  function getFilteredDeps() {
    switch (filter) {
      case "installed": return deps.filter((d) => d.installed);
      case "missing": return deps.filter((d) => !d.installed);
      default: return deps;
    }
  }

  const filtered = getFilteredDeps();
  const installedCount = filtered.filter((d) => d.installed).length;
  const totalSize = deps.reduce((sum, d) => sum + d.size_mb, 0);

  async function handleInstallSelected() {
    const missingIds = deps.filter((d) => !d.installed).map((d) => d.id);
    if (missingIds.length === 0) return;
    try {
      await invoke("start_install_dependencies", { selectedIds: missingIds, config });
    } catch (err) {
      console.error("Install error:", err);
    }
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-100">依赖管理</h2>
          {loadingDeps && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              正在刷新状态…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onOpenSetupWizard && (
            <button
              onClick={onOpenSetupWizard}
              className="neon-primary flex items-center gap-1.5 text-sm"
              title="回到欢迎页，可重新运行一键自动安装或进入高级模式"
            >
              <Wand2 className="h-3.5 w-3.5" />
              重新运行安装向导
            </button>
          )}
          <button
            onClick={() => setShowDiagnostics(true)}
            className="neon-secondary flex items-center gap-1.5 text-sm"
            title="诊断 WeGame 运行环境（网络/证书/Proton）"
          >
            <Activity className="h-3.5 w-3.5" />
            WeGame 诊断
          </button>
          <button
            onClick={() => fetchDeps(true)}
            disabled={loadingDeps}
            className="neon-secondary flex items-center gap-1.5 text-sm disabled:opacity-60"
            title="重新查询 winetricks 已安装状态（绕过缓存）"
          >
            <RefreshCw className={"h-3.5 w-3.5 " + (loadingDeps ? "animate-spin" : "")} />
            刷新状态
          </button>
          <button
            onClick={handleInstallSelected}
            disabled={progress.status === "running" || installedCount === filtered.length}
            className="neon-secondary flex items-center gap-1.5 text-sm"
          >
            <Download className="h-3.5 w-3.5" />
            安装缺失项
          </button>
          <button
            onClick={() => setShowReinstallConfirm(true)}
            disabled={progress.status === "running"}
            className="neon-secondary flex items-center gap-1.5 text-sm"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            全部重装
          </button>
        </div>
      </div>

      {/* Middleware Management (Wine / winetricks / Proton) */}
      <MiddlewareManager config={config} saveEnvironment={saveEnvironment} />

      {/* Custom paths (Wine prefix + WeGame install dir) */}
      <PathsSection config={config} saveEnvironment={saveEnvironment} variant="panel" />

      {/* WeGame itself (install / reinstall) — §4.2.2 */}
      <WeGameInstaller config={config} variant="manage" />

      {/* Winetricks dependencies */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
            <Layers className="h-4.5 w-4.5 text-primary" />
            Winetricks 依赖
          </h3>
          <div className="flex gap-2">
            {(["all", "installed", "missing"] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                  filter === f ? "bg-primary/15 text-primary" : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                }`}
              >
                {f === "all" ? "全部" : f === "installed" ? "已安装" : "未安装"}
                <span className={`ml-1.5 text-[10px] ${filter === f ? "text-primary/70" : "text-gray-600"}`}>
                  ({f === "all" ? deps.length : f === "installed" ? installedCount : filtered.length - installedCount})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Progress / status banners */}
        {progress.status === "running" && (
          <ProgressBar
            percent={progress.progress_percent}
            label={progress.current_dependency ? `正在安装: ${progress.current_dependency}` : "准备中..."}
            size="lg"
          />
        )}
        {progress.status === "completed" && !progress.error_message && (
          <div className="flex items-center gap-2 rounded-lg border border-neon-green/20 bg-neon-green/5 px-4 py-2.5 text-sm text-neon-green">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            所有依赖已成功安装完成！
          </div>
        )}
        {progress.status === "completed" && progress.error_message && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-2.5 text-sm text-yellow-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {progress.error_message}
          </div>
        )}
        {progress.status === "error" && (
          <div className="flex items-center gap-2 rounded-lg border border-neon-red/20 bg-neon-red/5 px-4 py-2.5 text-sm text-neon-red">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {progress.error_message || "安装过程中出现错误，请查看日志了解详情。"}
          </div>
        )}

        {/* Dependency list grouped by category */}
        {(["dotnet", "vcpp", "font", "browser", "system", "other"] as DependencyCategory[]).map((cat) => {
          const catDeps = filtered.filter((d) => d.category === cat);
          if (catDeps.length === 0) return null;
          return (
            <div key={cat}>
              <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <span className="inline-block h-1 w-1 rounded-full bg-primary/40"></span>
                {CATEGORY_LABELS[cat]}
              </h4>
              <div className="space-y-1.5">
                {catDeps.map((dep) => (
                  <div key={dep.id} className="glass-card-hover group flex items-center gap-3 px-4 py-3">
                    <div className="shrink-0">
                      {dep.installed ? (
                        <CheckCircle2 className="h-4.5 w-4.5 text-neon-green" />
                      ) : progress.current_dependency === dep.id && progress.status === "running" ? (
                        <Loader2 className="h-4.5 w-4.5 animate-spin text-primary" />
                      ) : (
                        <XCircle className="h-4.5 w-4.5 text-gray-600 group-hover:text-neon-red/60" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-200 truncate">{dep.name}</span>
                        {dep.required && (
                          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">必需</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{dep.description}</p>
                    </div>
                    <span className="shrink-0 tabular-nums text-xs text-gray-600">{dep.size_mb.toFixed(0)} MB</span>
                    {/* Single-item reinstall (§4.2.2). Visible only on hover
                        for installed deps so it doesn't clutter the list. */}
                    {dep.installed && progress.status !== "running" && (
                      <button
                        onClick={async () => {
                          try {
                            await invoke("start_install_dependencies", { selectedIds: [dep.id], config });
                          } catch (err) { console.error("Single-item reinstall error:", err); }
                        }}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded bg-white/5 hover:bg-white/10 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 flex items-center gap-1"
                        title={`重装 ${dep.name}`}
                      >
                        <RefreshCw className="h-3 w-3" />
                        重装
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Summary footer */}
        <div className="flex items-center justify-between px-2 pt-2 text-xs">
          <div className="flex items-center gap-4 text-gray-400">
            <span>已安装 <strong className="text-gray-200">{installedCount}</strong> / {filtered.length} 个</span>
            <span>预计占用 ~<strong className="text-gray-200">{totalSize.toFixed(0)}</strong> MB</span>
          </div>
        </div>
      </div>

      {/* Live logs */}
      {(logs.length > 0 || progress.status === "running") && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">实时日志</h4>
          <LogViewer logs={logs} maxHeight="250px" />
        </div>
      )}

      {/* Danger zone: Reset Wine Prefix */}
      <div className="border border-neon-red/20 rounded-xl overflow-hidden">
        <div className="bg-neon-red/5 px-5 py-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-neon-red" />
          <span className="font-semibold text-sm text-neon-red">危险操作区</span>
        </div>
        <div className="p-5 space-y-2">
          <p className="text-xs text-gray-400">以下操作不可逆，请谨慎使用。</p>
          <button
            onClick={() => setShowResetPrefixConfirm(true)}
            className="neon-danger text-sm"
          >
            重置 Wine Prefix 环境
          </button>
          <p className="text-xs text-gray-500">这将删除当前 Wine 前缀内的所有已安装程序、注册表与依赖组件。完成后可通过"重新配置环境"重新配置。</p>
        </div>
      </div>

      {/* Dialogs */}
      <DiagnosticsPanel
        open={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        config={config}
      />

      <ConfirmDialog
        open={showReinstallConfirm}
        title="重新安装所有依赖"
        message="这将重新安装所有已选择的依赖组件。如果某些组件损坏或需要更新可以使用此功能。确定要继续吗？"
        confirmText="确认重装"
        onConfirm={async () => {
          setShowReinstallConfirm(false);
          try {
            await invoke("start_install_dependencies", { selectedIds: deps.map((d) => d.id), config });
          } catch (err) { console.error("Reinstall error:", err); }
        }}
        onCancel={() => setShowReinstallConfirm(false)}
      />

      <ConfirmDialog
        open={showResetPrefixConfirm}
        title="重置 Wine Prefix 环境"
        message="这将彻底删除当前 Wine 前缀中的所有数据，包括：已安装的 Windows 程序、注册表配置、依赖组件等。此操作不可撤销。确定要继续吗？"
        confirmText="确认重置"
        danger
        onConfirm={async () => {
          setShowResetPrefixConfirm(false);
          try { await invoke("reset_environment", { config }); }
          catch (err) { console.error("Reset error:", err); }
        }}
        onCancel={() => setShowResetPrefixConfirm(false)}
      />
    </div>
  );
}

// ---------- Middleware Manager ----------

interface MiddlewareManagerProps {
  config: ReturnType<typeof useEnvironment>["config"];
  saveEnvironment: ReturnType<typeof useEnvironment>["saveEnvironment"];
}

function MiddlewareManager({ config, saveEnvironment }: MiddlewareManagerProps) {
  const [scanResults, setScanResults] = useState<DependencyScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<MiddlewareDownloadProgress | null>(null);
  const [customPaths, setCustomPaths] = useState<{ wine: string; winetricks: string }>({ wine: "", winetricks: "" });
  const [customPathStatus, setCustomPathStatus] = useState<Record<string, "idle" | "ok" | "fail">>({});

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await invoke<DependencyScanResult[]>("scan_system_dependencies");
      setScanResults(res);
    } catch (e) {
      console.error("scan middleware failed:", e);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { rescan(); }, [rescan]);

  useEffect(() => {
    // Track winetricks download events only — Proton download progress is
    // handled internally by <ProtonPicker>.
    const unsub = listen<MiddlewareDownloadProgress>("middleware-download-progress", (p) => {
      setDownloadProgress(p);
      if (p.phase === "done") {
        setTimeout(() => { setDownloadProgress(null); setDownloading(false); }, 1200);
      }
    });
    return () => { unsub(); };
  }, []);

  async function handleInstallWinetricks() {
    setDownloading(true);
    setDownloadProgress({ phase: "download", percent: 10, message: "正在下载 winetricks 脚本..." });
    try {
      const result = await invoke<{ success: boolean; path?: string; error?: string }>("install_winetricks_userlocal");
      if (result.success) {
        setDownloadProgress({ phase: "done", percent: 100, message: `已安装到 ${result.path}` });
      } else {
        setDownloadProgress({ phase: "done", percent: 100, message: `安装失败: ${result.error}` });
      }
      await rescan();
    } catch (e) {
      setDownloadProgress({ phase: "done", percent: 100, message: `安装失败: ${(e as Error).message}` });
    } finally {
      setTimeout(() => { setDownloading(false); setDownloadProgress(null); }, 1500);
    }
  }

  async function handleValidateCustomPath(depId: "wine" | "winetricks") {
    const p = customPaths[depId].trim();
    if (!p) return;
    try {
      const r = await invoke<ScannedPath | null>("validate_dependency_path", { depId, path: p });
      if (r) {
        setCustomPathStatus((s) => ({ ...s, [depId]: "ok" }));
        // Persist into extra_env_vars so launcher can pick it up
        const key = depId === "wine" ? "CUSTOM_WINE_PATH" : "CUSTOM_WINETRICKS_PATH";
        await saveEnvironment({
          ...config,
          extra_env_vars: { ...config.extra_env_vars, [key]: r.path },
        });
        // Refresh scan results so it appears in list
        await rescan();
      } else {
        setCustomPathStatus((s) => ({ ...s, [depId]: "fail" }));
      }
    } catch {
      setCustomPathStatus((s) => ({ ...s, [depId]: "fail" }));
    }
  }

  function findScanByDep(id: string): DependencyScanResult | undefined {
    return scanResults.find((s) => s.id === id);
  }

  const wineScan = findScanByDep("wine");
  const winetricksScan = findScanByDep("winetricks");

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <Layers className="h-4.5 w-4.5 text-accent" />
          中间层管理
        </h3>
        <button
          onClick={rescan}
          disabled={scanning}
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${scanning ? "animate-spin" : ""}`} />
          重新检测
        </button>
      </div>

      {/* Download/Install progress banner */}
      {(downloading || downloadProgress) && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <ProgressBar percent={downloadProgress?.percent ?? 0} label={downloadProgress?.message ?? "..."} size="md" />
        </div>
      )}

      {/* Proton section (shared) */}
      <ProtonPicker
        config={config}
        saveEnvironment={saveEnvironment}
        variant="panel"
        hideHeader={false}
      />

      {/* Wine section */}
      <MiddlewareBlock
        title="Wine"
        scan={wineScan}
        customPath={customPaths.wine}
        customPathStatus={customPathStatus.wine}
        onCustomPathChange={(v) => setCustomPaths((s) => ({ ...s, wine: v }))}
        onCustomPathSubmit={() => handleValidateCustomPath("wine")}
        actions={
          <>
            <CopyableCommand command="sudo pacman -S wine" />
            <a
              href={wineScan?.download_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:text-primary-light flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" /> 官方下载
            </a>
          </>
        }
      />

      {/* winetricks section */}
      <MiddlewareBlock
        title="winetricks"
        scan={winetricksScan}
        customPath={customPaths.winetricks}
        customPathStatus={customPathStatus.winetricks}
        onCustomPathChange={(v) => setCustomPaths((s) => ({ ...s, winetricks: v }))}
        onCustomPathSubmit={() => handleValidateCustomPath("winetricks")}
        actions={
          <>
            <button
              onClick={handleInstallWinetricks}
              disabled={downloading}
              className="text-xs text-primary hover:text-primary-light flex items-center gap-1 disabled:opacity-50"
            >
              <Download className="h-3 w-3" /> 一键下载到 ~/.local/bin
            </button>
            <a
              href={winetricksScan?.download_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" /> 官方仓库
            </a>
          </>
        }
      />
    </div>
  );
}

// ---------- Middleware Block (Wine / winetricks) ----------

interface MiddlewareBlockProps {
  title: string;
  scan?: DependencyScanResult;
  customPath: string;
  customPathStatus?: "idle" | "ok" | "fail";
  onCustomPathChange: (v: string) => void;
  onCustomPathSubmit: () => void;
  actions?: React.ReactNode;
}

function MiddlewareBlock({ title, scan, customPath, customPathStatus, onCustomPathChange, onCustomPathSubmit, actions }: MiddlewareBlockProps) {
  return (
    <div className="space-y-2 pt-2 border-t border-white/5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-sm font-medium text-gray-200">{title}</h4>
        <div className="flex items-center gap-3 flex-wrap">{actions}</div>
      </div>

      {scan && scan.paths.length > 0 ? (
        <div className="space-y-1">
          {scan.paths.map((p) => (
            <div key={p.path} className="flex items-center gap-2 rounded bg-surface-light/30 px-3 py-1.5 text-xs">
              <CheckCircle2 className="h-3 w-3 text-neon-green shrink-0" />
              <span className="font-mono text-gray-300 truncate flex-1">{p.path}</span>
              {p.version && <span className="text-gray-500 truncate max-w-[200px]">{p.version}</span>}
              <span className="shrink-0 rounded bg-white/5 px-1.5 py-px text-[10px] text-gray-400">{p.source}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500">未扫描到 {title}，可下载或填写自定义路径。</p>
      )}

      {/* Custom path input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={customPath}
          onChange={(e) => onCustomPathChange(e.target.value)}
          placeholder="自定义路径（如 /usr/local/bin/wine）"
          className="flex-1 rounded-lg border border-white/10 bg-surface-light/60 px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-primary/40 focus:outline-none"
        />
        <button
          onClick={onCustomPathSubmit}
          disabled={!customPath.trim()}
          className="neon-secondary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
        >
          <Save className="h-3 w-3" />
          验证并保存
        </button>
        {customPathStatus === "ok" && (
          <CheckCircle2 className="h-4 w-4 text-neon-green" />
        )}
        {customPathStatus === "fail" && (
          <XCircle className="h-4 w-4 text-neon-red" />
        )}
      </div>
    </div>
  );
}

// ---------- Custom Paths (Wine Prefix / WeGame install dir) ----------
// NOTE: Moved to src/components/config/PathsSection.tsx to be shared with
// SetupWizard. Keeping this file focused on middleware-specific UI.

// ---------- Small UI helpers ----------

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore */ }
      }}
      className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[11px] font-mono text-gray-300 hover:bg-white/10"
      title="复制命令"
    >
      {copied ? <Check className="h-3 w-3 text-neon-green" /> : <Copy className="h-3 w-3" />}
      {command}
    </button>
  );
}
