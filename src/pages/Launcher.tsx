import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { invoke } from "../utils/api";
import {
  Rocket,
  Square,
  Plus,
  ExternalLink,
  Gamepad2,
  FolderOpen,
  Search,
  AlertCircle,
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";
import useWegameStatus from "../hooks/useWegameStatus";
import useEnvironment from "../hooks/useEnvironment";
import type { GameEntry } from "../types";

// §4.3.1: launcher.log path hint shown in error banners so users
// know exactly where to look when a launch fails.
const LAUNCHER_LOG_HINT = "详细日志：~/.local/share/decky-wegame/logs/launcher.log";

type BannerKind = "error" | "warning";
interface BannerAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}
interface Banner {
  kind: BannerKind;
  title: string;
  detail?: string;
  hint?: string;
  actions?: BannerAction[];
}

export default function Launcher() {
  const { status, refetch } = useWegameStatus();
  const { config } = useEnvironment();
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    loadGames();
  }, [config]);

  async function loadGames() {
    setLoading(true);
    try {
      const result: GameEntry[] = await invoke("scan_games", { config });
      setGames(result);
    } catch (err) {
      console.error("Failed to scan games:", err);
    }
    setLoading(false);
  }

  async function handleLaunchWeGame() {
  // §4.3.1: immediate UI feedback + post-launch probing.
    setLaunchBusy(true);
    setBanner(null);
    try {
      await invoke("launch_wegame_cmd", { config });
      // Give WeGame a chance to spin up (proton cold start + wine prefix
      // init can take ~2s), then check whether the process is still alive.
      setTimeout(async () => {
        await refetch();
        // We can't read `status` here directly (stale closure); re-query.
        try {
          const fresh: { running: boolean } = await invoke("get_wegame_status_cmd");
          if (!fresh.running) {
            setBanner({
              kind: "warning",
              title: "WeGame 启动后随即退出",
              detail:
                "进程已被拉起但几秒内就退出，常见原因：prefix 损坏 / 依赖缺失 / Proton 版本不兼容。",
              hint:
                LAUNCHER_LOG_HINT +
                " （关注 [stderr] 与 “exited with code” 附近的行）",
            });
          } else {
            setBanner(null);
          }
        } catch {
          /* ignore status probe error */
        } finally {
          setLaunchBusy(false);
        }
      }, 3000);
    } catch (err) {
      setLaunchBusy(false);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Launch error:", err);
      const isNotInstalled =
        msg.includes("WeGame executable not found") ||
        msg.includes("WeGameLauncher.exe") ||
        msg.includes("not found. Please install WeGame");
      setBanner({
        kind: "error",
        title: isNotInstalled ? "尚未安装 WeGame" : "启动 WeGame 失败",
        detail: msg,
        hint: isNotInstalled
          ? "请通过「配置向导 → 步骤 5：安装 WeGame」自动下载并安装，或手动把 WeGameLauncher.exe 放到 prefix 里。"
          : LAUNCHER_LOG_HINT,
        actions: isNotInstalled
          ? [
              {
                label: "打开配置向导",
                onClick: () =>
                  window.dispatchEvent(new CustomEvent("open-setup-wizard")),
                icon: <Rocket className="h-3.5 w-3.5" />,
              },
            ]
          : undefined,
      });
    }
  }

  async function handleStopWeGame() {
    setStopBusy(true);
    try {
      await invoke("stop_wegame_cmd");
      setTimeout(async () => {
        await refetch();
        setStopBusy(false);
      }, 1000);
    } catch (err) {
      setStopBusy(false);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Stop error:", err);
      setBanner({
        kind: "error",
        title: "停止 WeGame 失败",
        detail: msg,
        hint: LAUNCHER_LOG_HINT,
      });
    }
  }

  async function handleAddToSteam(game: GameEntry) {
    setAddingId(game.name);
    try {
      await invoke("add_game_to_steam", { game, config });
      // Update local state
      setGames((prev) =>
        prev.map((g) =>
          g.exe_path === game.exe_path ? { ...g, added_to_steam: true } : g
        )
      );
    } catch (err) {
      console.error("Add to Steam error:", err);
    }
    setAddingId(null);
  }

  const filteredGames = games.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* §4.3.1: error / warning banner with actionable hint. */}
      {banner && (
        <div
          className={
            "flex items-start gap-3 rounded-lg border p-4 " +
            (banner.kind === "error"
              ? "border-red-500/40 bg-red-500/10"
              : "border-amber-500/40 bg-amber-500/10")
          }
        >
          {banner.kind === "error" ? (
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div
              className={
                "text-sm font-semibold " +
                (banner.kind === "error" ? "text-red-200" : "text-amber-200")
              }
            >
              {banner.title}
            </div>
            {banner.detail && (
              <div className="mt-1 text-xs text-gray-300 break-all whitespace-pre-wrap">
                {banner.detail}
              </div>
            )}
            {banner.hint && (
              <div className="mt-1.5 text-[11px] text-gray-500 break-all">
                {banner.hint}
              </div>
            )}
            {banner.actions && banner.actions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {banner.actions.map((a, i) => (
                  <button
                    key={i}
                    onClick={a.onClick}
                    className="neon-secondary inline-flex items-center gap-1.5 text-xs px-3 py-1.5"
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setBanner(null)}
            className="shrink-0 text-gray-400 hover:text-gray-200 transition-colors"
            title="关闭提示"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* WeGame Control Panel */}
      <div className="glass-card overflow-hidden">
        <div className={`flex items-center gap-4 p-5 ${
          status.running ? "bg-gradient-to-r from-blue-500/10 to-accent/8" : ""
        }`}>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20">
            <Rocket className={`h-6 w-6 ${status.running ? "text-primary animate-pulse" : "text-gray-300"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-100">WeGame 主程序</h3>
            <p className="mt-0.5 text-sm text-gray-400 truncate">
              {status.running
                ? `运行中 · PID ${status.pid ?? "N/A"}`
                : "未运行 - 点击启动按钮开始"}
            </p>
          </div>

          <div className="flex gap-2 shrink-0">
            {!status.running ? (
              <button
                onClick={handleLaunchWeGame}
                disabled={launchBusy}
                className="neon-primary flex items-center gap-2 text-sm px-5 py-2.5 disabled:opacity-60 disabled:cursor-wait"
              >
                {launchBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    启动中…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    启动 WeGame
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleStopWeGame}
                disabled={stopBusy}
                className="neon-danger flex items-center gap-2 text-sm px-5 py-2.5 disabled:opacity-60 disabled:cursor-wait"
              >
                {stopBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    停止中…
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4" />
                    停止进程
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Games Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-100">
            <Gamepad2 className="h-5 w-5 text-primary" />
            已检测的游戏
          </h2>
          <button onClick={loadGames} className="neon-secondary flex items-center gap-1.5 text-xs px-3 py-1.5">
            <Search className="h-3.5 w-3.5" />
            刷新扫描
          </button>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索游戏..."
            className="input-field pl-9"
          />
        </div>

        {/* Game list */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
            正在扫描 WeGame 游戏目录...
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="mb-3 h-12 w-12 text-gray-600" />
            <p className="text-sm text-gray-400">
              {games.length === 0
                ? "未检测到任何游戏。请先安装并启动 WeGame，然后通过 WeGame 安装游戏。"
                : "没有匹配的搜索结果。"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGames.map((game) => (
              <div key={game.exe_path} className="glass-card-hover p-4 group">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1 pr-2">
                    <h4 className="truncate font-semibold text-sm text-gray-200">
                      {game.name}
                    </h4>
                    <p className="mt-0.5 truncate text-xs text-gray-500" title={game.exe_path}>
                      {game.working_dir.split("/").pop()}
                    </p>
                  </div>
                  <div className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                    game.added_to_steam
                      ? "bg-neon-green/15 text-neon-green"
                      : "bg-white/5 text-gray-500"
                  }`}>
                    {game.added_to_steam ? "已添加" : "未添加"}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => handleAddToSteam(game)}
                    disabled={game.added_to_steam || addingId === game.name}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all ${
                      game.added_to_steam
                        ? "bg-white/5 text-gray-500 cursor-default"
                        : addingId === game.name
                          ? "bg-primary/20 text-primary cursor-wait"
                          : "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary-light"
                    }`}
                  >
                    {addingId === game.name ? (
                      <>
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
                        添加中
                      </>
                    ) : game.added_to_steam ? (
                        "已在 Steam 中"
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" />
                          添加到 Steam
                        </>
                      )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add to Steam instructions */}
      <div className="rounded-lg border border-white/5 bg-surface-light/30 p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          如何在 Steam 中启动
        </h4>
        <ol className="ml-4 list-decimal space-y-1 text-xs text-gray-500 leading-relaxed">
          <li>点击上方游戏卡片的「添加到 Steam」按钮</li>
          <li>打开 Steam 客户端</li>
          <li>点击左下角「+」→「添加非 Steam 游戏」</li>
          <li>选择自动生成的 .desktop 快捷方式文件</li>
          <li>右键该游戏 → 属性 → 兼容性 → 勾选强制使用兼容工具</li>
          <li>选择 GE-Proton 版本后即可通过 Steam 启动</li>
        </ol>
      </div>
    </div>
  );
}
