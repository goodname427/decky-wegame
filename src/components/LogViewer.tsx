import { useRef, useEffect } from "react";

interface LogViewerProps {
  logs: Array<{ level: string; message: string; timestamp: string }>;
  maxHeight?: string;
}

const lineClass: Record<string, string> = {
  info: "log-line-info",
  success: "log-line-success",
  error: "log-line-error",
  warn: "log-line-warn",
  debug: "log-line-debug",
};

export default function LogViewer({ logs, maxHeight = "300px" }: LogViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-surface-light/30 font-mono text-xs text-gray-500"
        style={{ maxHeight }}
      >
        <span>暂无日志输出</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/5 bg-surface/80">
      <div
        className="overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
        style={{ maxHeight }}
      >
        {logs.map((log, idx) => (
          <div key={idx} className={`${lineClass[log.level] || ""} whitespace-pre-wrap`}>
            <span className="text-gray-600 mr-2">[{log.timestamp}]</span>
            <span>{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
