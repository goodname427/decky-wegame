import { Rocket, ChevronRight, X } from "lucide-react";

/**
 * The first screen a user sees on a fresh install (PRD §4.1.0).
 *
 * This screen is a pure dispatcher — it MUST NOT trigger any network or
 * disk-write side effects of its own. Three explicit exits:
 *
 *   - onStartAuto     : user clicked the big "🚀 一键自动安装" button,
 *                       switch to <AutoSetupScreen /> and begin the
 *                       4-stage pipeline via auto_setup_start IPC.
 *   - onEnterAdvanced : user clicked the small "高级模式 →" button,
 *                       jump straight to the full 5-step wizard.
 *   - onSkip          : user clicked "稍后再说", close the wizard and
 *                       let them explore the app (a red banner on the
 *                       launcher page will remind them WeGame isn't
 *                       installed yet).
 *
 * Button size contrast (big primary vs. small secondary) is intentional —
 * PRD §4.1.0 describes it as "默认策略的表达" for the 95% / 5% user split.
 */
export interface WelcomeScreenProps {
  onStartAuto: () => void;
  onEnterAdvanced: () => void;
  onSkip: () => void;
}

export default function WelcomeScreen({
  onStartAuto,
  onEnterAdvanced,
  onSkip,
}: WelcomeScreenProps) {
  return (
    <div className="relative flex flex-col items-center justify-center px-6 py-16 min-h-[540px]">
      {/* Top-right "skip for now" escape link */}
      <button
        onClick={onSkip}
        className="absolute right-4 top-4 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        aria-label="稍后再说，跳过向导"
      >
        <X size={14} />
        <span>稍后再说</span>
      </button>

      {/* Intro sentence */}
      <div className="mb-10 text-center max-w-xl">
        <h1 className="text-2xl font-semibold text-white mb-3">
          欢迎使用 WeGame Launcher
        </h1>
        <p className="text-sm text-gray-400 leading-relaxed">
          接下来将为你配置 WeGame 运行环境（选择 Proton、创建 Wine Prefix、安装依赖、引导安装 WeGame 本体）。
        </p>
      </div>

      {/* Primary BIG button */}
      <button
        onClick={onStartAuto}
        className="group relative flex items-center gap-3 rounded-2xl bg-gradient-to-br from-primary to-accent px-10 py-5 text-xl font-semibold text-white shadow-2xl hover:shadow-primary/40 transition-all hover:scale-[1.02] active:scale-100"
      >
        <Rocket size={28} className="drop-shadow" />
        <span>🚀 一键自动安装</span>
      </button>
      <p className="mt-4 text-xs text-gray-500 text-center max-w-md">
        全程 2-5 分钟（视网络而定），任何步骤失败会引导你手动处理。
      </p>

      {/* Bottom-corner small advanced-mode button (low contrast, but always visible) */}
      <div className="absolute bottom-5 right-5">
        <button
          onClick={onEnterAdvanced}
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-gray-400 hover:bg-white/5 hover:text-gray-200 hover:border-white/20 transition-colors"
        >
          <span>高级模式</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
