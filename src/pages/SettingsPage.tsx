import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { PackageCheck, Settings as SettingsIcon, Download, Settings2 } from "lucide-react";
import Dependencies from "./Dependencies";
import Settings from "./Settings";
import UpdateChecker from "./UpdateChecker";

type SubTab = "dependencies" | "advanced" | "update";

interface SettingsPageProps {
  onOpenSetupWizard?: () => void;
}

export default function SettingsPage({ onOpenSetupWizard }: SettingsPageProps) {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<SubTab>("dependencies");
  
  // Handle navigation state from About page
  useEffect(() => {
    if (location.state?.activeTab) {
      setActiveTab(location.state.activeTab);
    }
  }, [location.state]);
  
  const handleTabChange = (tab: SubTab) => {
    setActiveTab(tab);
  };

  const tabs: { id: SubTab; label: string; icon: React.ElementType }[] = [
    { id: "dependencies", label: "依赖管理", icon: PackageCheck },
    { id: "advanced", label: "高级配置", icon: SettingsIcon },
    { id: "update", label: "版本更新", icon: Download },
  ];

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Sub-tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-xl bg-surface-light/40 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-primary/15 text-primary shadow-sm"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tab content */}
      <div className="animate-fade-in">
        {activeTab === "dependencies" && <Dependencies />}
        {activeTab === "advanced" && <Settings />}
        {activeTab === "update" && <UpdateChecker />}
      </div>
    </div>
  );
}
