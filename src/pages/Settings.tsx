import { useState } from "react";
import { invoke } from "../utils/api";
import {
  Save,
  RotateCcw,
  FolderOpen,
  Cpu,
  Terminal,
  Upload,
  AlertTriangle,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import useEnvironment, { useProtonVersions } from "../hooks/useEnvironment";
import ConfirmDialog from "../components/ConfirmDialog";

export default function Settings() {
  const { config, saveEnvironment, systemInfo } = useEnvironment();
  const { versions: protonVersions } = useProtonVersions();

  const [localConfig, setLocalConfig] = useState(config || {
    wine_prefix_path: "",
    proton_path: "",
    wegame_install_path: "",
    extra_env_vars: {},
    launch_args: "",
  });
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<"idle" | "success" | "error">("idle");
  const [envVars, setEnvVars] = useState<[string, string][]>(
    Object.entries(config.extra_env_vars || {})
  );

  // Sync when config changes
  if (JSON.stringify(localConfig) !== JSON.stringify(config)) {
    setLocalConfig(config);
    setEnvVars(Object.entries(config.extra_env_vars || {}));
  }

  function updateField<K extends keyof typeof localConfig>(key: K, value: (typeof localConfig)[K]) {
    setLocalConfig((prev: typeof localConfig) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    const newEnv: Record<string, string> = {};
    for (const [k, v] of envVars as [string, string][]) {
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

  async function handleCleanupLogs() {
    try {
      await invoke("cleanup_logs");
      setCleanupStatus("success");
      setTimeout(() => setCleanupStatus("idle"), 3000);
    } catch (err) {
      console.error("Log cleanup error:", err);
      setCleanupStatus("error");
      setTimeout(() => setCleanupStatus("idle"), 3000);
    }
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

      {/* Cache & Logs Management */}
      <div className="glass-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-100">
          <Trash2 className="h-4.5 w-4.5 text-neon-yellow" />
          缓存与日志管理
        </h3>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-gray-200">清理日志文件</h4>
              <p className="text-xs text-gray-500 mt-1">删除所有历史日志文件，释放磁盘空间</p>
            </div>
            <div className="flex items-center gap-2">
              {cleanupStatus === "success" && (
                <span className="text-xs text-neon-green flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  清理完成
                </span>
              )}
              {cleanupStatus === "error" && (
                <span className="text-xs text-neon-red">清理失败</span>
              )}
              <button
                onClick={() => setShowCleanupConfirm(true)}
                className="neon-secondary text-sm px-4 py-2"
              >
                清理日志
              </button>
            </div>
          </div>

          <div className="border-t border-white/10 pt-3">
            <h4 className="text-sm font-medium text-gray-200 mb-2">日志文件信息</h4>
            <div className="text-xs text-gray-500 space-y-1">
              <p>• 每次运行都会创建新的日志文件，格式：<code className="bg-white/5 px-1 rounded">应用名_YYYYMMDD_HHMMSS.log</code></p>
              <p>• 最多保留最近 20 个会话的日志文件</p>
              <p>• 单个日志文件最大 5MB，自动轮转</p>
              <p>• 日志目录：<code className="bg-white/5 px-1 rounded">~/.local/share/decky-wegame/logs/</code></p>
            </div>
          </div>
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

      {/* Log cleanup confirmation dialog */}
      <ConfirmDialog
        open={showCleanupConfirm}
        title="清理日志文件"
        message="这将删除所有历史日志文件，包括应用日志、依赖安装日志等。清理后无法恢复，但不会影响当前运行的应用。确定要继续吗？"
        confirmText="确认清理"
        onConfirm={async () => {
          setShowCleanupConfirm(false);
          await handleCleanupLogs();
        }}
        onCancel={() => setShowCleanupConfirm(false)}
      />
    </div>
  );
}
