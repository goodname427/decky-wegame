import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Save,
  RotateCcw,
  FolderOpen,
  Cpu,
  Terminal,
  Upload,
  AlertTriangle,
} from "lucide-react";
import useEnvironment from "../hooks/useEnvironment";
import useProtonVersions from "../hooks/useProtonVersions";
import ConfirmDialog from "../components/ConfirmDialog";

export default function Settings() {
  const { config, saveEnvironment, systemInfo } = useEnvironment();
  const { versions: protonVersions } = useProtonVersions();

  const [localConfig, setLocalConfig] = useState(config);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [envVars, setEnvVars] = useState<[string, string][]>(
    Object.entries(config.extra_env_vars || {})
  );

  // Sync when config changes
  if (JSON.stringify(localConfig) !== JSON.stringify(config)) {
    setLocalConfig(config);
    setEnvVars(Object.entries(config.extra_env_vars || {}));
  }

  function updateField<K extends keyof typeof localConfig>(key: K, value: (typeof localConfig)[K]) {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    const newEnv: Record<string, string> = {};
    for (const [k, v] of envVars) {
      if (k.trim()) newEnv[k.trim()] = v;
    }
    await saveEnvironment({ ...localConfig, extra_env_vars: newEnv });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function addEnvVar() {
    setEnvVars([...envVars, ["", ""]]);
  }

  function removeEnvVar(index: number) {
    setEnvVars(envVars.filter((_, i) => i !== index));
    setSaved(false);
  }

  function updateEnvVar(index: number, keyOrValue: "key" | "value", val: string) {
    const updated = [...envVars];
    if (keyOrValue === "key") {
      updated[index] = [val, updated[index][1]];
    } else {
      updated[index] = [updated[index][0], val];
    }
    setEnvVars(updated);
    setSaved(false);
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Path Configuration */}
      <div className="glass-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-100">
          <FolderOpen className="h-4.5 w-4.5 text-primary" />
          路径配置
        </h3>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">Wine 前缀路径</label>
            <input
              type="text"
              value={localConfig.wine_prefix_path}
              onChange={(e) => updateField("wine_prefix_path", e.target.value)}
              placeholder="~/.local/share/decky-wegame/prefix"
              className="input-field font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">WeGame 的 Wine 兼容环境存储目录</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">Proton 可执行文件路径</label>
            <select
              value={localConfig.proton_path}
              onChange={(e) => updateField("proton_path", e.target.value)}
              className="input-field cursor-pointer"
            >
              <option value="">-- 自动检测（推荐） --</option>
              {protonVersions.map((v) => (
                <option key={v.path} value={v.path}>
                  {v.name}{v.is_recommended ? " ★" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">留空则自动选择最佳 Proton 版本</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">WeGame 安装路径</label>
            <input
              type="text"
              value={localConfig.wegame_install_path}
              onChange={(e) => updateField("wegame_install_path", e.target.value)}
              placeholder="Wine 前缀内的 WeGame 安装目录"
              className="input-field font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">通常自动检测，仅在异常情况需要修改</p>
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div className="glass-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-100">
          <Terminal className="h-4.5 w-4.5 text-accent" />
          环境变量
        </h3>

        <div className="space-y-2">
          {envVars.map(([key, value], idx) => (
            <div key={idx} className="flex items-start gap-2">
              <input
                type="text"
                value={key}
                placeholder="变量名 (如 WINEDLLOVERRIDES)"
                onChange={(e) => updateEnvVar(idx, "key", e.target.value)}
                className="w-[200px] shrink-0 rounded-lg border border-white/10 bg-surface-light/60 px-3 py-2 text-xs text-gray-200 focus:border-primary/40 focus:outline-none"
              />
              <span className="mt-2 text-gray-500">=</span>
              <input
                type="text"
                value={value}
                placeholder="值 (如 mscoree=n)"
                onChange={(e) => updateEnvVar(idx, "value", e.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-white/10 bg-surface-light/60 px-3 py-2 text-xs text-gray-200 focus:border-primary/40 focus:outline-none"
              />
              <button
                onClick={() => removeEnvVar(idx)}
                className="shrink-0 mt-1 p-1 text-gray-500 hover:text-neon-red transition-colors"
              >✕</button>
            </div>
          ))}
        </div>

        <button onClick={addEnvVar} className="mt-3 text-xs text-primary hover:text-primary-light transition-colors">
          + 添加环境变量
        </button>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            ["WINEDLLOVERRIDES", "mscoree=n"],
            ["DXVK_STATE_CACHE_PATH", ""],
            ["WINEARCH", "win64"],
            ["PULSE_LATENCY_MSEC", "60"],
          ].map(([k, v]) => (
            <button
              key={k}
              onClick={() => {
                addEnvVar();
                setEnvVars((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = [k, v];
                  return next;
                });
                setSaved(false);
              }}
              className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-gray-400 hover:bg-primary/10 hover:text-primary transition-all"
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Launch Parameters */}
      <div className="glass-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-100">
          <Terminal className="h-4.5 w-4.5 text-neon-yellow" />
          启动参数
        </h3>

        <textarea
          value={localConfig.launch_args}
          onChange={(e) => updateField("launch_args", e.target.value)}
          placeholder="额外的启动参数，每行一个..."
          rows={4}
          className="input-field resize-y font-mono text-xs leading-relaxed"
        />

        <div className="mt-2 flex justify-between text-xs text-gray-500">
          <span>传递给 WeGame.exe 的额外命令行参数</span>
          <button
            onClick={() => updateField("launch_args", "")}
            className="hover:text-gray-300 transition-colors"
          >恢复默认</button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="border border-neon-red/20 rounded-xl overflow-hidden">
        <div className="bg-neon-red/5 px-5 py-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-neon-red" />
          <span className="font-semibold text-sm text-neon-red">危险操作区</span>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-400">以下操作不可逆，请谨慎使用。</p>
          <button
            onClick={() => setShowResetConfirm(true)}
            className="neon-danger text-sm w-full sm:w-auto"
          >
            重置 Wine Prefix 环境
          </button>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={handleSave} className="neon-primary flex items-center gap-2 text-sm px-6">
          <Save className="h-4 w-4" />
          保存设置
        </button>
        {saved && (
          <span className="text-sm text-neon-green animate-fade-in">已保存 ✓</span>
        )}
      </div>

      {/* Reset confirmation dialog */}
      <ConfirmDialog
        open={showResetConfirm}
        title="重置 Wine Prefix 环境"
        message="这将彻底删除当前 Wine 前缀中的所有数据，包括：已安装的 Windows 程序、注册表配置、依赖组件等。此操作不可撤销。确定要继续吗？"
        confirmText="确认重置"
        danger
        onConfirm={async () => {
          try {
            await invoke("reset_environment", { config: localConfig });
            setShowResetConfirm(false);
          } catch (err) {
            console.error("Reset error:", err);
          }
        }}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
}
