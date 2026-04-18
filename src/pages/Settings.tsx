import { useState, useEffect, useRef } from "react";
import { invoke } from "../utils/api";
import {
  Terminal,
  Trash2,
  CheckCircle2,
  Info,
} from "lucide-react";
import useEnvironment from "../hooks/useEnvironment";
import ConfirmDialog from "../components/ConfirmDialog";

const AUTOSAVE_DEBOUNCE_MS = 500;

export default function Settings() {
  const { config, saveEnvironment } = useEnvironment();

  const [launchArgs, setLaunchArgs] = useState<string>(config.launch_args || "");
  const [envVars, setEnvVars] = useState<[string, string][]>(
    Object.entries(config.extra_env_vars || {})
  );
  const [saved, setSaved] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [showClearLaunchArgsConfirm, setShowClearLaunchArgsConfirm] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<"idle" | "success" | "error">("idle");

  // Signature of the latest config fetched from backend, used to detect external changes
  const configSigRef = useRef<string>("");
  const currentSig = JSON.stringify({ launch_args: config.launch_args, extra_env_vars: config.extra_env_vars });
  if (currentSig !== configSigRef.current) {
    configSigRef.current = currentSig;
    // Pull new values when config changes externally (e.g. config file reload)
    if (launchArgs !== (config.launch_args || "")) setLaunchArgs(config.launch_args || "");
    const incoming = Object.entries(config.extra_env_vars || {}) as [string, string][];
    if (JSON.stringify(incoming) !== JSON.stringify(envVars)) setEnvVars(incoming);
  }

  // Debounced auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const newEnv: Record<string, string> = {};
      for (const [k, v] of envVars) {
        if (k.trim()) newEnv[k.trim()] = v;
      }
      // Only save if values actually differ from config
      const nextConfig = { ...config, launch_args: launchArgs, extra_env_vars: newEnv };
      if (
        nextConfig.launch_args !== config.launch_args ||
        JSON.stringify(nextConfig.extra_env_vars) !== JSON.stringify(config.extra_env_vars)
      ) {
        saveEnvironment(nextConfig)
          .then(() => {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          })
          .catch((err: unknown) => {
            console.error("Auto-save failed:", err);
          });
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchArgs, envVars]);

  function addEnvVar() {
    setEnvVars([...envVars, ["", ""]]);
  }

  function removeEnvVar(index: number) {
    setEnvVars(envVars.filter((_, i) => i !== index));
  }

  function updateEnvVar(index: number, keyOrValue: "key" | "value", val: string) {
    const updated = [...envVars];
    if (keyOrValue === "key") {
      updated[index] = [val, updated[index][1]];
    } else {
      updated[index] = [updated[index][0], val];
    }
    setEnvVars(updated);
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
      {/* Header note: autosave */}
      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-gray-400">
        <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
        <div className="flex-1">
          修改将在停止输入后 <strong className="text-gray-200">自动保存</strong>（无需点击按钮）。路径配置、重置环境等已迁移到「依赖管理」子页签。
        </div>
        {saved && (
          <span className="flex items-center gap-1 text-neon-green animate-fade-in">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已保存
          </span>
        )}
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
                title="删除该环境变量"
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
                setEnvVars((prev) => [...prev, [k, v]]);
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
          value={launchArgs}
          onChange={(e) => setLaunchArgs(e.target.value)}
          placeholder="额外的启动参数，每行一个..."
          rows={4}
          className="input-field resize-y font-mono text-xs leading-relaxed"
        />

        <div className="mt-2 flex justify-between text-xs text-gray-500">
          <span>传递给 WeGame.exe 的额外命令行参数</span>
          <button
            onClick={() => setShowClearLaunchArgsConfirm(true)}
            disabled={!launchArgs}
            className="hover:text-gray-300 transition-colors disabled:opacity-40"
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

      {/* Clear launch args confirm */}
      <ConfirmDialog
        open={showClearLaunchArgsConfirm}
        title="恢复默认启动参数"
        message="这将清空当前所有启动参数。确定要继续吗？"
        confirmText="确认清空"
        onConfirm={() => {
          setLaunchArgs("");
          setShowClearLaunchArgsConfirm(false);
        }}
        onCancel={() => setShowClearLaunchArgsConfirm(false)}
      />
    </div>
  );
}
