import { useState } from "react";
import {
  Github,
  Heart,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Bug,
  Info,
  ArrowUpCircle,
  Loader2,
  CheckCircle,
} from "lucide-react";
import useEnvironment from "../hooks/useEnvironment";
import { invoke } from "../utils/api";
import { FAQ_ITEMS, APP_NAME, APP_VERSION } from "../utils/constants";
import type { UpdateInfo } from "../types";

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-sm font-medium text-gray-200 pr-4">{question}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-gray-500" /> : <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />}
      </button>
      {open && (
        <div className="px-4 pb-3 pt-0 animate-fade-in">
          <p className="text-sm text-gray-400 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

export default function About() {
  const { systemInfo } = useEnvironment();
  const [quickChecking, setQuickChecking] = useState(false);
  const [quickUpdateInfo, setQuickUpdateInfo] = useState<UpdateInfo | null>(null);

  async function quickCheckUpdate() {
    setQuickChecking(true);
    setQuickUpdateInfo(null);
    try {
      const info = (await invoke("check_for_update", { channel: "stable" })) as UpdateInfo;
      setQuickUpdateInfo(info);
    } catch {
      // Silently fail for quick check
    } finally {
      setQuickChecking(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* About Card */}
      <div className="glass-card p-8 text-center">
        {/* Logo */}
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/20">
          <svg viewBox="0 0 128 128" className="h-12 w-12" fill="none">
            <circle cx="64" cy="64" r="56" fill="#0A0E17"/>
            <path d="M38 52 Q38 42 48 42 L80 42 Q90 42 90 52 L90 76 Q90 88 80 88 L72 88 Q66 88 64 82 L62 78 Q61 76 59 78 L56 82 Q54 88 48 88 L40 88 Q30 88 30 76 Z" fill="#00D4AA" opacity="0.9"/>
            <text x="64" y="72" fontFamily="Arial" fontWeight="bold" fontSize="18" fill="#0A0E17" textAnchor="middle">W</text>
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-gradient mb-1">{APP_NAME}</h2>
        <p className="text-sm text-gray-400 mb-4">WeGame Launcher for Steam Deck</p>

        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
          v{APP_VERSION}
        </div>

        {/* Quick update check */}
        <div className="mt-4">
          {quickUpdateInfo ? (
            quickUpdateInfo.has_update ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs">
                <ArrowUpCircle className="h-3.5 w-3.5 text-primary" />
                <span className="text-primary">新版本 {quickUpdateInfo.latest_version} 可用</span>
                {quickUpdateInfo.html_url && (
                  <a href={quickUpdateInfo.html_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-light underline">
                    查看
                  </a>
                )}
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 text-xs text-neon-green">
                <CheckCircle className="h-3.5 w-3.5" />
                已是最新版本
              </div>
            )
          ) : (
            <button
              onClick={quickCheckUpdate}
              disabled={quickChecking}
              className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors"
            >
              {quickChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-3.5 w-3.5" />
              )}
              {quickChecking ? "检查中..." : "检查更新"}
            </button>
          )}
        </div>

        <div className="mt-6 flex justify-center gap-3">
          <a
            href="https://github.com/CGL/decky-wegame"
            target="_blank"
            rel="noopener noreferrer"
            className="neon-secondary flex items-center gap-1.5 text-xs px-4 py-2"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>

        <p className="mt-6 text-xs text-gray-600 flex items-center justify-center gap-1">
          Made with <Heart className="inline h-3 w-3 text-neon-red" /> for the Linux gaming community · MIT License
        </p>
      </div>

      {/* System Info */}
      <div className="glass-card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
          <Info className="h-4 w-4" />
          系统信息
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ["操作系统", systemInfo?.os_version || "--"],
            ["架构", systemInfo?.architecture || "--"],
            ["磁盘空间", `${systemInfo?.free_disk_gb.toFixed(1) ?? "--"} GB 可用 / ${systemInfo?.total_disk_gb.toFixed(1) ?? "--"} GB`],
            ["Proton 版本", `${systemInfo?.proton_versions.length ?? 0} 个可用`],
            ["winetricks", systemInfo?.winetricks_available ? "已安装 ✓" : "未安装 ✗"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-dark/50 px-3 py-2.5">
              <span className="text-xs text-gray-500 block mb-0.5">{label}</span>
              <span className="text-sm text-gray-200 font-medium break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ Section */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
          <Bug className="h-4.5 w-4.5 text-neon-yellow" />
          常见问题
        </h3>

        {FAQ_ITEMS.map((item, idx) => (
          <FAQItem key={idx} question={item.question} answer={item.answer} />
        ))}
      </div>

      {/* Diagnostic hint */}
      <div className="glass-card p-4 text-center">
        <p className="text-xs text-gray-500">
          遇到问题？请在 GitHub 上提交 Issue，并附上运行日志。
        </p>
        <a
          href="https://github.com/CGL/decky-wegame/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary-light transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          提交反馈
        </a>
      </div>
    </div>
  );
}
