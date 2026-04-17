import { useState, useEffect } from "react";
import { invoke } from "../utils/api";
import {
  Rocket,
  Square,
  Plus,
  ExternalLink,
  Gamepad2,
  FolderOpen,
  Search,
} from "lucide-react";
import useWegameStatus from "../hooks/useWegameStatus";
import useEnvironment from "../hooks/useEnvironment";
import type { GameEntry } from "../types";

export default function Launcher() {
  const { status, refetch } = useWegameStatus();
  const { config } = useEnvironment();
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
    try {
      await invoke("launch_wegame_cmd", { config });
      setTimeout(refetch, 1000);
    } catch (err) {
      console.error("Launch error:", err);
    }
  }

  async function handleStopWeGame() {
    try {
      await invoke("stop_wegame_cmd");
      setTimeout(refetch, 1000);
    } catch (err) {
      console.error("Stop error:", err);
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
              <button onClick={handleLaunchWeGame} className="neon-primary flex items-center gap-2 text-sm px-5 py-2.5">
                <Rocket className="h-4 w-4" />
                启动 WeGame
              </button>
            ) : (
              <button onClick={handleStopWeGame} className="neon-danger flex items-center gap-2 text-sm px-5 py-2.5">
                <Square className="h-4 w-4" />
                停止进程
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
