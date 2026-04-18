import { useCallback, useEffect, useState } from "react";
import { Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import { invoke, listen } from "../../utils/api";
import ConfirmDialog from "../ConfirmDialog";
import ProgressBar from "../ProgressBar";
import { useProtonVersions } from "../../hooks/useEnvironment";
import type {
  EnvironmentConfig,
  MiddlewareDownloadProgress,
  ProtonInfo,
} from "../../types";

export type ProtonPickerVariant = "wizard" | "panel";

interface ProtonPickerProps {
  config: EnvironmentConfig;
  saveEnvironment: (config: EnvironmentConfig) => Promise<void>;
  /** When true, clicking a version only reports it via onSelect without
   *  persisting — wizard uses this so the selection is confirmed on
   *  "next step" rather than immediately. */
  variant?: ProtonPickerVariant;
  /** Wizard-only: report selection change to the parent's localConfig. */
  onSelect?: (path: string) => void;
  /** Optional: override the header title. */
  title?: string;
  /** Optional: hide the header (useful when embedded in another section). */
  hideHeader?: boolean;
}

/**
 * Shared Proton version picker.
 *
 * Handles: scanning, selecting a version, downloading the latest GE-Proton,
 * and deleting user-owned versions. Backed by the same IPC surface used by
 * both the wizard and the Dependencies page.
 */
export default function ProtonPicker({
  config,
  saveEnvironment,
  variant = "panel",
  onSelect,
  title = "Proton 兼容层",
  hideHeader = false,
}: ProtonPickerProps) {
  const { versions, refetch: refetchProton } = useProtonVersions();
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<MiddlewareDownloadProgress | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProtonInfo | null>(null);

  useEffect(() => {
    const unsub = listen<MiddlewareDownloadProgress>("middleware-download-progress", (p) => {
      setDownloadProgress(p);
      if (p.phase === "done") {
        setTimeout(() => { setDownloadProgress(null); setDownloading(false); }, 1200);
      }
    });
    return () => { unsub(); };
  }, []);

  const handleSelect = useCallback(async (p: ProtonInfo) => {
    if (variant === "wizard") {
      onSelect?.(p.path);
      return;
    }
    await saveEnvironment({ ...config, proton_path: p.path });
  }, [variant, onSelect, saveEnvironment, config]);

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

  async function handleDeleteProton(p: ProtonInfo) {
    const res = await invoke<{ success: boolean; error?: string }>("delete_proton_version", { path: p.path });
    if (res.success) {
      // If deleted one was in use, clear it
      if (config.proton_path === p.path) {
        if (variant === "wizard") {
          onSelect?.("");
        } else {
          await saveEnvironment({ ...config, proton_path: "" });
        }
      }
      await refetchProton();
    } else {
      alert(`删除失败: ${res.error}`);
    }
    setDeleteTarget(null);
  }

  const activePath =
    variant === "wizard" ? config.proton_path : config.proton_path;

  return (
    <div className="space-y-2">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-200">{title}</h4>
          <div className="flex items-center gap-3">
            <button
              onClick={refetchProton}
              className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
              title="重新扫描系统中已安装的 Proton 版本"
            >
              <RefreshCw className="h-3 w-3" />
              重新检测
            </button>
            <button
              onClick={handleDownloadGeProton}
              disabled={downloading}
              className="text-xs text-primary hover:text-primary-light flex items-center gap-1 disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              下载最新 GE-Proton
            </button>
          </div>
        </div>
      )}

      {/* Download progress */}
      {(downloading || downloadProgress) && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
          <ProgressBar
            percent={downloadProgress?.percent ?? 0}
            label={downloadProgress?.message ?? "..."}
            size="md"
          />
        </div>
      )}

      {versions.length === 0 ? (
        <p className="text-xs text-gray-500">
          未扫描到 Proton 版本，可点击{hideHeader ? "上方" : "右上角"}"下载最新 GE-Proton"。
        </p>
      ) : (
        <div className="space-y-1.5">
          {versions.map((p) => {
            const selected = activePath === p.path;
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
                <button onClick={() => handleSelect(p)} className="flex-1 min-w-0 text-left">
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
