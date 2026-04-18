import { useState } from "react";
import {
  X,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";
import { runWegameDiagnostics } from "../utils/api";

// Must match electron/backend/diagnostics.ts
export type DiagnosticStatus = "pass" | "warn" | "fail" | "skip";
export interface DiagnosticResult {
  id: string;
  title: string;
  status: DiagnosticStatus;
  message: string;
  detail?: string;
  suggestion?: string;
  elapsedMs: number;
}
export interface DiagnosticReport {
  timestamp: string;
  results: DiagnosticResult[];
  overall: DiagnosticStatus;
}

interface DiagnosticsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Current environment config — passed through to the backend */
  config?: any;
}

const STATUS_META: Record<DiagnosticStatus, { label: string; icon: any; cls: string }> = {
  pass: { label: "通过", icon: CheckCircle2, cls: "text-emerald-400" },
  warn: { label: "警告", icon: AlertTriangle, cls: "text-amber-400" },
  fail: { label: "失败", icon: XCircle, cls: "text-red-400" },
  skip: { label: "跳过", icon: MinusCircle, cls: "text-gray-500" },
};

export default function DiagnosticsPanel({ open, onClose, config }: DiagnosticsPanelProps) {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const r = await runWegameDiagnostics(config);
      setReport(r as DiagnosticReport);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleExport() {
    if (!report) return;
    const lines: string[] = [];
    lines.push(`# WeGame 运行诊断报告`);
    lines.push(`时间: ${report.timestamp}`);
    lines.push(`总体状态: ${STATUS_META[report.overall].label}`);
    lines.push("");
    for (const r of report.results) {
      lines.push(`## ${STATUS_META[r.status].label} — ${r.title} (${r.elapsedMs}ms)`);
      lines.push(r.message);
      if (r.suggestion) lines.push(`> 建议: ${r.suggestion}`);
      if (r.detail) {
        lines.push("```");
        lines.push(r.detail);
        lines.push("```");
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wegame-diagnostics-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="mx-4 w-full max-w-3xl rounded-xl border border-white/10 bg-surface-light p-6 shadow-2xl shadow-black/40 animate-slide-up max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neon-primary/10">
              <Activity className="h-5 w-5 text-neon-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-100">WeGame 运行诊断</h3>
              <p className="text-xs text-gray-400">
                检查网络、DNS、证书、Proton 版本等 WeGame 常见阻塞点
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-400">
            {report && (
              <span>
                总体：
                <span className={STATUS_META[report.overall].cls + " font-semibold"}>
                  {STATUS_META[report.overall].label}
                </span>
                <span className="ml-2 text-xs">
                  ({new Date(report.timestamp).toLocaleString()})
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {report && !running && (
              <button
                onClick={handleExport}
                className="neon-secondary flex items-center gap-1.5 text-sm"
              >
                <Download className="h-4 w-4" />
                导出报告
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={running}
              className="neon-primary flex items-center gap-1.5 text-sm disabled:opacity-60"
            >
              <RefreshCw className={"h-4 w-4 " + (running ? "animate-spin" : "")} />
              {running ? "检测中..." : report ? "重新检测" : "开始检测"}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mt-4 flex-1 overflow-auto">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {!report && !running && !error && (
            <div className="flex h-48 flex-col items-center justify-center text-center text-gray-500">
              <Activity className="mb-3 h-10 w-10 text-gray-600" />
              <p className="text-sm">点击「开始检测」以诊断 WeGame 运行环境</p>
              <p className="mt-1 text-xs text-gray-600">
                诊断不会修改任何系统配置，仅收集只读信息
              </p>
            </div>
          )}

          {running && !report && (
            <div className="flex h-48 items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-gray-400">
                <RefreshCw className="h-5 w-5 animate-spin text-neon-primary" />
                正在执行检测...
              </div>
            </div>
          )}

          {report && (
            <div className="space-y-2">
              {report.results.map((r) => {
                const meta = STATUS_META[r.status];
                const Icon = meta.icon;
                const isOpen = expanded[r.id];
                const hasDetail = Boolean(r.detail || r.suggestion);
                return (
                  <div
                    key={r.id}
                    className="rounded-lg border border-white/10 bg-black/20"
                  >
                    <button
                      onClick={() => hasDetail && toggle(r.id)}
                      className={
                        "flex w-full items-center gap-3 p-3 text-left " +
                        (hasDetail ? "hover:bg-white/5" : "cursor-default")
                      }
                    >
                      <Icon className={"h-5 w-5 shrink-0 " + meta.cls} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-200">
                            {r.title}
                          </span>
                          <span className={"text-xs " + meta.cls}>
                            {meta.label}
                          </span>
                          <span className="text-xs text-gray-600">
                            {r.elapsedMs}ms
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-gray-400 truncate">
                          {r.message}
                        </div>
                      </div>
                      {hasDetail && (
                        isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
                        )
                      )}
                    </button>
                    {isOpen && hasDetail && (
                      <div className="border-t border-white/5 px-3 py-2 text-xs">
                        {r.suggestion && (
                          <div className="mb-2 rounded-md bg-neon-primary/10 p-2 text-neon-primary">
                            💡 {r.suggestion}
                          </div>
                        )}
                        {r.detail && (
                          <pre className="whitespace-pre-wrap break-all text-gray-400">
                            {r.detail}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end border-t border-white/10 pt-4">
          <button onClick={onClose} className="neon-secondary">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
