import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FolderOpen } from "lucide-react";
import ConfirmDialog from "../ConfirmDialog";
import type { EnvironmentConfig } from "../../types";

export type PathsSectionVariant = "wizard" | "panel";

interface PathsSectionProps {
  config: EnvironmentConfig;
  saveEnvironment: (config: EnvironmentConfig) => Promise<void>;
  /** wizard: used inline inside SetupWizard, uses updateConfig-like callback.
   *  panel:  used in Dependencies page, auto-saves on debounce. */
  variant?: PathsSectionVariant;
  /** When in wizard mode, the wizard manages its own localConfig and just
   *  wants to be told what changed. Provide this to override auto-save. */
  onLocalChange?: (partial: Partial<EnvironmentConfig>) => void;
}

/**
 * Shared configuration unit: Wine Prefix path + WeGame install path.
 *
 * Single source of truth for both the first-time wizard and the Dependencies
 * management page. In "panel" mode it debounces and persists via
 * saveEnvironment; in "wizard" mode it reports changes through onLocalChange
 * so the wizard can keep holding pending config until the user confirms.
 */
export default function PathsSection({
  config,
  saveEnvironment,
  variant = "panel",
  onLocalChange,
}: PathsSectionProps) {
  const [prefixPath, setPrefixPath] = useState(config.wine_prefix_path);
  const [wegamePath, setWegamePath] = useState(config.wegame_install_path);
  const [saved, setSaved] = useState(false);
  const [showPrefixWarn, setShowPrefixWarn] = useState<string | null>(null);

  // Sync when config updates externally (e.g. another tab saved)
  const lastConfigSig = useRef("");
  const sig = `${config.wine_prefix_path}|${config.wegame_install_path}`;
  if (lastConfigSig.current !== sig) {
    lastConfigSig.current = sig;
    if (config.wine_prefix_path !== prefixPath) setPrefixPath(config.wine_prefix_path);
    if (config.wegame_install_path !== wegamePath) setWegamePath(config.wegame_install_path);
  }

  // Panel mode: debounce-save. Wizard mode: forward to onLocalChange.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (variant === "wizard") {
      if (onLocalChange) {
        onLocalChange({ wine_prefix_path: prefixPath, wegame_install_path: wegamePath });
      }
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (prefixPath === config.wine_prefix_path && wegamePath === config.wegame_install_path) return;
      try {
        await saveEnvironment({ ...config, wine_prefix_path: prefixPath, wegame_install_path: wegamePath });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        console.error("save custom path failed:", e);
      }
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixPath, wegamePath, variant]);

  function handlePrefixChange(v: string) {
    // Only warn if there was already a non-empty prefix AND it's actually changing.
    if (v !== config.wine_prefix_path && config.wine_prefix_path) {
      setShowPrefixWarn(v);
      return;
    }
    setPrefixPath(v);
  }

  const containerCls =
    variant === "wizard"
      ? "space-y-3"
      : "glass-card p-5 space-y-3";

  return (
    <div className={containerCls}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <FolderOpen className="h-4.5 w-4.5 text-primary" />
          {variant === "wizard" ? "安装路径" : "自定义安装路径"}
        </h3>
        {saved && variant === "panel" && (
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
        <p className="mt-1 text-xs text-gray-500">
          WeGame 的 Wine 兼容环境存储目录（修改后旧目录不会自动迁移）
        </p>
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
        <p className="mt-1 text-xs text-gray-500">
          通常自动检测，仅在异常情况需要修改
        </p>
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
