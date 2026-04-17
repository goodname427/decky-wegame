import { useState, useEffect, useCallback } from "react";
import { invoke } from "../utils/api";
import {
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import ProgressBar from "../components/ProgressBar";
import LogViewer from "../components/LogViewer";
import ConfirmDialog from "../components/ConfirmDialog";
import { useEnvironment } from "../hooks/useEnvironment";
import { useInstallProgress } from "../hooks/useInstallProgress";
import type { DependencyItem, DependencyCategory } from "../types";

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

type FilterType = "all" | "installed" | "missing" | "error";

export default function Dependencies() {
  const { config } = useEnvironment();
  const { progress, logs } = useInstallProgress();
  const [deps, setDeps] = useState<DependencyItem[]>(
    ALL_DEPS.map((d) => ({ ...d, installed: false }))
  );
  const [filter, setFilter] = useState<FilterType>("all");
  const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);

  // Fetch dependency list with installed status from backend
  const fetchDeps = useCallback(async () => {
    try {
      const result: DependencyItem[] = await invoke("get_dependency_list", { config });
      setDeps(result);
    } catch (err) {
      console.error("Failed to fetch dependency list:", err);
    }
  }, [config]);

  // Load deps on mount and when config changes
  useEffect(() => {
    fetchDeps();
  }, [fetchDeps]);

  // Refresh deps list when installation completes
  useEffect(() => {
    if (progress.status === "completed" || progress.status === "error") {
      fetchDeps();
    }
  }, [progress.status, fetchDeps]);

  function getFilteredDeps() {
    switch (filter) {
      case "installed": return deps.filter((d) => d.installed);
      case "missing": return deps.filter((d) => !d.installed);
      case "error":
        return deps; // Would show failed ones
      default:
        return deps;
    }
  }

  const filtered = getFilteredDeps();
  const installedCount = deps.filter((d) => d.installed).length;
  const totalSize = deps.reduce((sum, d) => sum + d.size_mb, 0);

  async function handleInstallSelected() {
    const missingIds = deps.filter((d) => !d.installed).map((d) => d.id);
    if (missingIds.length === 0) return;

    try {
      await invoke("start_install_dependencies", {
        selectedIds: missingIds,
        config,
      });
    } catch (err) {
      console.error("Install error:", err);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-100">依赖管理</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleInstallSelected()}
            disabled={progress.status === "running" || installedCount === deps.length}
            className="neon-primary flex items-center gap-1.5 text-sm"
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

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "installed", "missing"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              filter === f
                ? "bg-primary/15 text-primary"
                : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
            }`}
          >
            {f === "all" ? "全部" : f === "installed" ? "已安装" : "未安装"}
            <span className={`ml-1.5 text-[10px] ${filter === f ? "text-primary/70" : "text-gray-600"}`}>
              ({f === "all" ? deps.length : f === "installed" ? installedCount : deps.length - installedCount})
            </span>
          </button>
        ))}
      </div>

      {/* Install progress bar (when installing) */}
      {progress.status === "running" && (
        <ProgressBar
          percent={progress.progress_percent}
          label={
            progress.current_dependency
              ? `正在安装: ${progress.current_dependency}`
              : "准备中..."
          }
          size="lg"
        />
      )}

      {/* Progress completed banner */}
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
      {(["dotnet", "vcpp", "font", "browser", "system", "other"] as DependencyCategory[]).map(
        (cat) => {
          const catDeps = filtered.filter((d) => d.category === cat);
          if (catDeps.length === 0) return null;

          return (
            <div key={cat}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <span className="inline-block h-1 w-1 rounded-full bg-primary/40"></span>
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="space-y-1.5">
                {catDeps.map((dep) => (
                  <div
                    key={dep.id}
                    className="glass-card-hover group flex items-center gap-3 px-4 py-3"
                  >
                    {/* Status icon */}
                    <div className="shrink-0">
                      {dep.installed ? (
                        <CheckCircle2 className="h-4.5 w-4.5 text-neon-green" />
                      ) : progress.current_dependency === dep.id && progress.status === "running" ? (
                        <Loader2 className="h-4.5 w-4.5 animate-spin text-primary" />
                      ) : (
                        <XCircle className="h-4.5 w-4.5 text-gray-600 group-hover:text-neon-red/60" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-200 truncate">
                          {dep.name}
                        </span>
                        {dep.required && (
                          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                            必需
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{dep.description}</p>
                    </div>

                    {/* Size */}
                    <span className="shrink-0 tabular-nums text-xs text-gray-600">
                      {dep.size_mb.toFixed(0)} MB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        }
      )}

      {/* Summary footer */}
      <div className="glass-card mt-4 flex items-center justify-between px-4 py-3 text-xs">
        <div className="flex items-center gap-4 text-gray-400">
          <span>已安装 <strong className="text-gray-200">{installedCount}</strong> / {deps.length} 个</span>
          <span>预计占用 ~<strong className="text-gray-200">{totalSize.toFixed(0)}</strong> MB</span>
        </div>
      </div>

      {/* Log viewer when installing or has logs */}
      {(logs.length > 0 || progress.status === "running") && (
        <div className="pt-2">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">实时日志</h4>
          <LogViewer logs={logs} maxHeight="250px" />
        </div>
      )}

      {/* Reinstall confirm dialog */}
      <ConfirmDialog
        open={showReinstallConfirm}
        title="重新安装所有依赖"
        message="这将重新安装所有已选择的依赖组件。如果某些组件损坏或需要更新可以使用此功能。确定要继续吗？"
        confirmText="确认重装"
        onConfirm={async () => {
          setShowReinstallConfirm(false);
          try {
            await invoke("start_install_dependencies", {
              selectedIds: deps.map((d) => d.id),
              config,
            });
          } catch (err) {
            console.error("Reinstall error:", err);
          }
        }}
        onCancel={() => setShowReinstallConfirm(false)}
      />
    </div>
  );
}
