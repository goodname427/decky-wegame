import { useState, useEffect, useCallback, useRef } from "react";
import { invoke, listen } from "../utils/api";
import {
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Wand2,
  FolderOpen,
  Trash2,
  Layers,
  Plus,
  ExternalLink,
  Copy,
  Check,
  Save,
} from "lucide-react";
import ProgressBar from "../components/ProgressBar";
import LogViewer from "../components/LogViewer";
import ConfirmDialog from "../components/ConfirmDialog";
import { useEnvironment, useProtonVersions } from "../hooks/useEnvironment";
import { useInstallProgress } from "../hooks/useInstallProgress";
import type {
  DependencyItem,
  DependencyCategory,
  DependencyScanResult,
  ScannedPath,
  MiddlewareDownloadProgress,
  ProtonInfo,
} from "../types";

const CATEGORY_LABELS: Record<DependencyCategory, string> = {
  dotnet: ".NET Framework",
  vcpp: "Visual C++ 运行时",
  font: "字体支持",
  browser: "浏览器组件",
  system: "系统组件",
  other: "其他组件",
};

const ALL_DEPS: Omit<DependencyItem, "installed" | "install_time">[] = [
  { id: "dotnet46", name: ".NET Framework 4.6", category: "dotnet", description: "WeGame 核心运行时依赖", size_mb: 180, required: true },
  { id: "dotnet48", name: ".NET Framework 4.8", category: "dotnet", description: "最新版 .NET Framework 运行时（推荐）", size_mb: 200, required: true },
  { id: "vcpp2005", name: "Visual C++ 2005 Redistributable", category: "vcpp", description: "部分旧组件依赖的 VC++ 运行时", size_mb: 6, required: false },
  { id: "vcpp2008", name: "Visual C++ 2008 Redistributable", category: "vcpp", description: "部分游戏组件依赖", size_mb: 9, required: true },
  { id: "vcpp2010", name: "Visual C++ 2010 Redistributable", category: "vcpp", description: "广泛使用的 VC++ 运行时版本", size_mb: 11, required: true },
  { id: "vcpp2012", name: "Visual C++ 2012 Redistributable", category: "vcpp", description: "部分游戏和工具依赖", size_mb: 12, required: true },
  { id: "vcpp2013", name: "Visual C++ 2013 Redistributable", category: "vcpp", description: "常用 VC++ 运行时", size_mb: 13, required: true },
  { id: "vcpp2015-2022", name: "Visual C++ 2015-2022 (x64)", category: "vcpp", description: "最新版 VC++ 运行时集合包", size_mb: 35, required: true },
  { id: "font-microsoft-core", name: "Microsoft Core Fonts", category: "font", description: "Arial、Times New Roman 等基础字体", size_mb: 8, required: true },
  { id: "font-cjk", name: "CJK Support Fonts (CJKfonts)", category: "font", description: "中日韩文字支持字体，解决中文乱码问题", size_mb: 25, required: true },
  { id: "ie8", name: "Internet Explorer 8", category: "browser", description: "WeGame 内嵌浏览器依赖的 IE 内核组件", size_mb: 150, required: true },
  { id: "gdiplus", name: "GDI+ (gdiplus)", category: "system", description: "Windows 图形设备接口库", size_mb: 3, required: true },
  { id: "mscoree", name: ".NET Core Runtime (mscoree)", category: "system", description: ".NET Framework 核心执行引擎", size_mb: 2, required: true },
  { id: "directx9", name: "DirectX 9.0c (d3dx9)", category: "system", description: "DirectX 9 运行时库，部分游戏需要", size_mb: 50, required: true },
  { id: "vcrun6", name: "Visual Basic 6 Runtime (vcrun6)", category: "other", description: "VB6 运行时兼容层", size_mb: 5, required: false },
];

type FilterType = "all" | "installed" | "missing";

interface DependenciesProps {
  onOpenSetupWizard?: () => void;
}

export default function Dependencies({ onOpenSetupWizard }: DependenciesProps) {
  const { config, saveEnvironment, refetch: refetchConfig } = useEnvironment();
  const { progress, logs } = useInstallProgress();
  const [deps, setDeps] = useState<DependencyItem[]>(ALL_DEPS.map((d) => ({ ...d, installed: false })));
  const [filter, setFilter] = useState<FilterType>("all");
  const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);
  const [showResetPrefixConfirm, setShowResetPrefixConfirm] = useState(false);

  const fetchDeps = useCallback(async () => {
    try {
      const result: DependencyItem[] = await invoke("get_dependency_list", { config });
      setDeps(result);
    } catch (err) {
      console.error("Failed to fetch dependency list:", err);
    }
  }, [config]);

  useEffect(() => {
    fetchDeps();
  }, [fetchDeps]);

  useEffect(() => {
    if (progress.status === "completed" || progress.status === "error") {
      fetchDeps();
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
        <h2 className="text-lg font-semibold text-gray-100">依赖管理</h2>
        <div className="flex items-center gap-2">
          {onOpenSetupWizard && (
            <button
              onClick={onOpenSetupWizard}
              className="neon-primary flex items-center gap-1.5 text-sm"
              title="重新打开环境设置向导"
            >
              <Wand2 className="h-3.5 w-3.5" />
              重新配置环境
            </button>
          )}
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

      {/* Middleware Management */}
      <MiddlewareManager config={config} saveEnvironment={saveEnvironment} refetchConfig={refetchConfig} />

      {/* Custom paths */}
      <CustomPaths config={config} saveEnvironment={saveEnvironment} />

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
  refetchConfig: ReturnType<typeof useEnvironment>["refetch"];
}

function MiddlewareManager({ config, saveEnvironment, refetchConfig }: MiddlewareManagerProps) {
  const { versions: protonVersions, refetch: refetchProton } = useProtonVersions();
  const [scanResults, setScanResults] = useState<DependencyScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<MiddlewareDownloadProgress | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProtonInfo | null>(null);
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
    const unsub = listen<MiddlewareDownloadProgress>("middleware-download-progress", (p) => {
      setDownloadProgress(p);
      if (p.phase === "done") {
        setTimeout(() => { setDownloadProgress(null); setDownloading(false); }, 1200);
      }
    });
    return () => { unsub(); };
  }, []);

  async function handleSelectProton(p: ProtonInfo) {
    await saveEnvironment({ ...config, proton_path: p.path });
  }

  async function handleDownloadGeProton() {
    setDownloading(true);
    setDownloadProgress({ phase: "download", percent: 0, message: "开始下载..." });
    try {
      const result = await invoke<{ success: boolean; version?: string; error?: string }>("download_ge_proton");
      if (!result.success) {
        setDownloadProgress({ phase: "done", percent: 100, message: `下载失败: ${result.error}` });
      }
      await refetchProton();
    } catch (e) {
      setDownloadProgress({ phase: "done", percent: 100, message: `下载失败: ${(e as Error).message}` });
    }
  }

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

  async function handleDeleteProton(p: ProtonInfo) {
    const res = await invoke<{ success: boolean; error?: string }>("delete_proton_version", { path: p.path });
    if (res.success) {
      // If deleted one was in use, clear it
      if (config.proton_path === p.path) {
        await saveEnvironment({ ...config, proton_path: "" });
      }
      await refetchProton();
      await refetchConfig();
    } else {
      alert(`删除失败: ${res.error}`);
    }
    setDeleteTarget(null);
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

      {/* Proton section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-200">Proton 兼容层</h4>
          <button
            onClick={handleDownloadGeProton}
            disabled={downloading}
            className="text-xs text-primary hover:text-primary-light flex items-center gap-1 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            下载最新 GE-Proton
          </button>
        </div>
        {protonVersions.length === 0 ? (
          <p className="text-xs text-gray-500">未扫描到 Proton 版本，可点击右上角下载最新 GE-Proton。</p>
        ) : (
          <div className="space-y-1.5">
            {protonVersions.map((p) => {
              const selected = config.proton_path === p.path;
              const isUserOwned =
                p.path.includes("/.steam/root/compatibilitytools.d/") ||
                p.path.includes("/.local/share/Steam/compatibilitytools.d/");
              return (
                <div
                  key={p.path}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${
                    selected ? "border-primary/40 bg-primary/5" : "border-white/5 bg-surface-light/30"
                  }`}
                >
                  <button onClick={() => handleSelectProton(p)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200 truncate">{p.name}</span>
                      {p.is_recommended && (
                        <span className="shrink-0 rounded bg-neon-green/10 px-1.5 py-px text-[10px] text-neon-green">推荐</span>
                      )}
                      {selected && (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] text-primary flex items-center gap-0.5">
                          <Check className="h-2.5 w-2.5" /> 使用中
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500 font-mono">{p.path}</p>
                  </button>
                  {isUserOwned && (
                    <button
                      onClick={() => setDeleteTarget(p)}
                      className="p-1.5 text-gray-500 hover:text-neon-red"
                      title="删除该 Proton 版本"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除 Proton 版本"
        message={`确认删除 ${deleteTarget?.name}？\n路径：${deleteTarget?.path}\n\n此操作不可撤销。`}
        confirmText="确认删除"
        danger
        onConfirm={() => deleteTarget && handleDeleteProton(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
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

interface CustomPathsProps {
  config: ReturnType<typeof useEnvironment>["config"];
  saveEnvironment: ReturnType<typeof useEnvironment>["saveEnvironment"];
}

function CustomPaths({ config, saveEnvironment }: CustomPathsProps) {
  const [prefixPath, setPrefixPath] = useState(config.wine_prefix_path);
  const [wegamePath, setWegamePath] = useState(config.wegame_install_path);
  const [saved, setSaved] = useState(false);
  const [showPrefixWarn, setShowPrefixWarn] = useState<string | null>(null);

  // Sync when config updates externally
  const lastConfigSig = useRef("");
  const sig = `${config.wine_prefix_path}|${config.wegame_install_path}`;
  if (lastConfigSig.current !== sig) {
    lastConfigSig.current = sig;
    if (config.wine_prefix_path !== prefixPath) setPrefixPath(config.wine_prefix_path);
    if (config.wegame_install_path !== wegamePath) setWegamePath(config.wegame_install_path);
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (prefixPath === config.wine_prefix_path && wegamePath === config.wegame_install_path) return;
      try {
        await saveEnvironment({ ...config, wine_prefix_path: prefixPath, wegame_install_path: wegamePath });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) { console.error("save custom path failed:", e); }
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixPath, wegamePath]);

  function handlePrefixChange(v: string) {
    if (v !== config.wine_prefix_path && config.wine_prefix_path) {
      setShowPrefixWarn(v);
      return;
    }
    setPrefixPath(v);
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <FolderOpen className="h-4.5 w-4.5 text-primary" />
          自定义安装路径
        </h3>
        {saved && (
          <span className="text-xs text-neon-green flex items-center gap-1 animate-fade-in">
            <CheckCircle2 className="h-3 w-3" /> 已保存
          </span>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-300">Wine 前缀路径</label>
        <input
          type="text"
          value={prefixPath}
          onChange={(e) => handlePrefixChange(e.target.value)}
          placeholder="~/.local/share/decky-wegame/prefix"
          className="input-field font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">WeGame 的 Wine 兼容环境存储目录（修改后旧目录不会自动迁移）</p>
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-300">WeGame 安装路径</label>
        <input
          type="text"
          value={wegamePath}
          onChange={(e) => setWegamePath(e.target.value)}
          placeholder="Wine 前缀内的 WeGame 安装目录"
          className="input-field font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">通常自动检测，仅在异常情况需要修改</p>
      </div>

      <ConfirmDialog
        open={!!showPrefixWarn}
        title="修改 Wine 前缀路径"
        message="修改前缀路径后，原前缀目录不会自动迁移到新路径；已安装的 WeGame、注册表、依赖组件将不再被使用。请确认已备份或知晓风险。"
        confirmText="我已确认，修改"
        onConfirm={() => {
          if (showPrefixWarn !== null) setPrefixPath(showPrefixWarn);
          setShowPrefixWarn(null);
        }}
        onCancel={() => setShowPrefixWarn(null)}
      />
    </div>
  );
}

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
