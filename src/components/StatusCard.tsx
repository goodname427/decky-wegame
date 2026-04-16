import { ReactNode } from "react";

interface StatusCardProps {
  title: string;
  value: string | ReactNode;
  subtitle?: string;
  icon: ReactNode;
  status?: "ready" | "running" | "warning" | "error" | "idle";
  onClick?: () => void;
}

const statusClass = {
  ready: "border-neon-green/20",
  running: "border-blue-400/30 animate-pulse-glow",
  warning: "border-neon-yellow/20",
  error: "border-neon-red/20",
  idle: "border-white/5",
};

export default function StatusCard({ title, value, subtitle, icon, status = "idle", onClick }: StatusCardProps) {
  return (
    <div
      className={`glass-card-hover p-4 cursor-pointer ${statusClass[status]}`}
      onClick={onClick}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
        {icon}
        <span>{title}</span>
      </div>
      <div className="text-lg font-bold text-gray-100">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-gray-500">{subtitle}</div>}
    </div>
  );
}
