import { useLocation } from "react-router-dom";
import {
  Menu,
  LayoutDashboard,
  Rocket,
  Settings as SettingsIcon,
  HelpCircle,
} from "lucide-react";

interface HeaderBarProps {
  onToggleSidebar: () => void;
}

const routeTitles: Record<string, { title: string; icon: React.ElementType }> = {
  "/": { title: "控制台", icon: LayoutDashboard },
  "/launcher": { title: "启动器", icon: Rocket },
  "/settings": { title: "设置", icon: SettingsIcon },
  "/about": { title: "关于帮助", icon: HelpCircle },
};

export default function HeaderBar({ onToggleSidebar }: HeaderBarProps) {
  const location = useLocation();
  const info = routeTitles[location.pathname] || routeTitles["/"];
  const Icon = info.icon;

  return (
    <header className="fixed top-0 right-0 z-10 flex h-[60px] items-center justify-between border-b border-white/5 bg-surface-dark/80 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Icon className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold text-gray-100">{info.title}</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Status indicator */}
        <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-gray-400">
          <span className="status-dot-idle" />
          <span>v0.1.0</span>
        </div>
      </div>
    </header>
  );
}
