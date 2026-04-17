import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "../utils/api";
import {
  Settings2,
  PackageCheck,
  Rocket,
  Square,
  HardDrive,
  Cpu,
  FolderOpen,
  Layers,
  Plus,
  RefreshCw,
} from "lucide-react";
import StatusCard from "../components/StatusCard";
import ConfirmDialog from "../components/ConfirmDialog";
import useWegameStatus from "../hooks/useWegameStatus";
import useEnvironment from "../hooks/useEnvironment";

export default function Dashboard() {
  const navigate = useNavigate();
  const { status: wegameStatus, refetch: refetchStatus } = useWegameStatus();
  const { config, systemInfo } = useEnvironment();

  const [initing, setIniting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Prefix info
  const prefixExists = systemInfo !== null; // Simplified - would check real state
  const envStatus = prefixExists
    ? wegameStatus.running
      ? "running"
      : "ready"
    : "idle";

  const statusTextMap: Record<string, string> = {
    ready: "环境就绪",
    running: "运行中",
    idle: "未初始化",
  };

  async function handleInit() {
    setIniting(true);
    try {
      await invoke("init_environment", { config });
      refetchStatus();
    } catch (err) {
      console.error("Init failed:", err);
    }
    setIniting(false);
  }

  async function handleLaunch() {
    setLaunching(true);
    try {
      await invoke("launch_wegame_cmd", { config });
      refetchStatus();
    } catch (err) {
      console.error("Launch failed:", err);
    }
    setLaunching(false);
  }

  async function handleStop() {
    try {
      await invoke("stop_wegame_cmd");
      refetchStatus();
    } catch (err) {
      console.error("Stop failed:", err);
    }
  }

  return (
    <div className="space-y-6">
      {/* Global Status Banner */}
      <div className="glass-card overflow-hidden">
        <div className={`flex items-center gap-4 p-5 ${
          wegameStatus.running
            ? "bg-gradient-to-r from-blue-500/10 to-primary/10"
            : prefixExists
              ? "bg-gradient-to-r from-neon-green/8 to-primary/8"
              : "bg-gradient-to-r from-gray-500/8 to-gray-400/8"
        }`}>
          <div className={`status-dot-${envStatus} scale-150`}></div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">
              {wegameStatus.running ? "WeGame 正在运行" : statusTextMap[envStatus] || "未知状态"}
            </h2>
            <p className="mt-0.5 text-sm text-gray-400">
              {wegameStatus.running
                ? `PID: ${wegameStatus.pid || "N/A"} · 运行中`
                : prefixExists
                  ? "Wine 前缀已就绪，可以启动 WeGame"
                  : "请先初始化 WeGame 运行环境"
              }
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {!prefixExists && (
          <button onClick={handleInit} disabled={initing} className="neon-primary flex items-center justify-center gap-2 py-3 text-sm">
            <Settings2 className="h-4 w-4" />
            {initing ? "初始化中..." : "初始化环境"}
          </button>
        )}
        {prefixExists && !wegameStatus.running && (
          <button onClick={handleLaunch} disabled={launching} className="neon-primary flex items-center justify-center gap-2 py-3 text-sm">
            <Rocket className="h-4 w-4" />
            {launching ? "启动中..." : "启动 WeGame"}
          </button>
        )}
        {wegameStatus.running && (
          <button onClick={handleStop} className="neon-danger flex items-center justify-center gap-2 py-3 text-sm">
            <Square className="h-4 w-4" />
            停止进程
          </button>
        )}
        <button onClick={() => navigate("/settings")} className="neon-secondary flex items-center justify-center gap-2 py-3 text-sm">
          <PackageCheck className="h-4 w-4" />
          安装依赖
        </button>
        <button onClick={() => navigate("/launcher")} className="neon-secondary flex items-center justify-center gap-2 py-3 text-sm">
          <Plus className="h-4 w-4" />
          添加到 Steam
        </button>
        <button onClick={() => navigate("/settings")} className="neon-secondary flex items-center justify-center gap-2 py-3 text-sm">
          <RefreshCw className="h-4 w-4" />
          环境设置
        </button>
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={!prefixExists}
          className="neon-danger flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-30"
        >
          重置环境
        </button>
      </div>

      {/* Environment Info Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          title="Wine 前缀"
          value={prefixExists ? "已创建" : "未创建"}
          subtitle={config.wine_prefix_path.split("/").pop()}
          icon={<HardDrive className="h-3.5 w-3.5" />}
          status={prefixExists ? "ready" : "idle"}
          onClick={() => navigate("/settings")}
        />
        <StatusCard
          title="Proton 版本"
          value={
            config.proton_path
              ? config.proton_path.split("/").pop() || "已选择"
              : "自动检测"
          }
          subtitle={systemInfo?.proton_versions.length ? `${systemInfo.proton_versions.length} 个可用版本` : ""}
          icon={<Cpu className="h-3.5 w-3.5" />}
          status={config.proton_path ? "ready" : "warning"}
          onClick={() => navigate("/settings")}
        />
        <StatusCard
          title="WeGame 路径"
          value="Tencent / WeGame"
          subtitle={prefixExists ? "已检测到" : "未安装"}
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          status={prefixExists ? "ready" : "idle"}
          onClick={() => navigate("/settings")}
        />
        <StatusCard
          title="系统依赖"
          value="--/--"
          subtitle="点击查看详情"
          icon={<Layers className="h-3.5 w-3.5" />}
          status="idle"
          onClick={() => navigate("/settings")}
        />
      </div>

      {/* System Info Bar */}
      {systemInfo && (
        <div className="glass-card p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-400">
            <span>
              <strong className="text-gray-300">OS:</strong> {systemInfo.os_version.replace(/PRETTY_NAME=/g, '').replace(/"/g, '')}
            </span>
            <span><strong className="text-gray-300">架构:</strong> {systemInfo.architecture}</span>
            <span><strong className="text-gray-300">磁盘:</strong> {systemInfo.free_disk_gb.toFixed(1)} GB 可用 / {systemInfo.total_disk_gb.toFixed(1)} GB</span>
            <span><strong className="text-gray-300">winetricks:</strong> {systemInfo.winetricks_available ? "已安装" : "未安装"}</span>
          </div>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      <ConfirmDialog
        open={showResetConfirm}
        title="重置 Wine 环境"
        message="此操作将删除当前 Wine 前缀中的所有数据，包括已安装的 Windows 程序和配置。WeGame 安装包不会被删除。确定要继续吗？"
        confirmText="确认重置"
        danger
        onConfirm={async () => {
          await invoke("reset_environment", { config });
          setShowResetConfirm(false);
          refetchStatus();
        }}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
}
