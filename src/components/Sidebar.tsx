import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Rocket,
  Settings as SettingsIcon,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "控制台" },
  { to: "/launcher", icon: Rocket, label: "启动器" },
  { to: "/settings", icon: SettingsIcon, label: "设置" },
  { to: "/about", icon: HelpCircle, label: "关于帮助" },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={`flex flex-col border-r border-white/5 bg-surface/95 backdrop-blur-xl
        transition-all duration-300 ease-out z-20 ${
          collapsed ? "w-[68px]" : "w-[240px]"
        }`}
    >
      {/* Logo Area */}
      <div className="flex h-[60px] items-center gap-3 border-b border-white/5 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent">
          <Gamepad2 className="h-5 w-5 text-surface-dark" />
        </div>
        {!collapsed && (
          <span className="text-gradient text-lg font-bold whitespace-nowrap animate-fade-in">
            WeGame Launcher
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/" ? undefined : false}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 group
               ${isActive
                ? "bg-primary/10 text-primary shadow-sm shadow-primary/10"
                : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
              }
               ${collapsed ? "justify-center" : ""}`
            }
          >
            <item.icon
              className={`h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110`}
            />
            {!collapsed && (
              <span className="whitespace-nowrap animate-fade-in">{item.label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-white/5 p-3">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-gray-500 transition-colors hover:text-gray-300"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span className="text-xs">收起</span>}
        </button>
      </div>
    </aside>
  );
}
