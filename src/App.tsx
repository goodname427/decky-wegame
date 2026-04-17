import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import HeaderBar from "./components/HeaderBar";
import Dashboard from "./pages/Dashboard";
import SetupWizard from "./pages/SetupWizard";
import Launcher from "./pages/Launcher";
import SettingsPage from "./pages/SettingsPage";
import About from "./pages/About";
import { invoke } from "./utils/api";

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [checkedFirstRun, setCheckedFirstRun] = useState(false);

  // Check if this is the first run (no Wine prefix exists yet)
  useEffect(() => {
    async function checkFirstRun() {
      try {
        const config = await invoke("get_config");
        const prefixInfo = await invoke("get_prefix_info", { config });
        if (!prefixInfo.exists) {
          setShowSetupWizard(true);
        }
      } catch {
        // If we can't check, show setup wizard to be safe
        setShowSetupWizard(true);
      } finally {
        setCheckedFirstRun(true);
      }
    }
    checkFirstRun();
  }, []);

  // Don't render until we've checked first-run status
  if (!checkedFirstRun) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-dark">
        <div className="text-gray-400 text-sm">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-dark">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <HeaderBar onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 pt-[60px]">
          <div className="mx-auto max-w-7xl animate-fade-in">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/launcher" element={<Launcher />} />
              <Route path="/settings" element={<SettingsPage onOpenSetupWizard={() => setShowSetupWizard(true)} />} />
              <Route path="/about" element={<About />} />
            </Routes>
          </div>
        </main>
      </div>

      {/* Setup Wizard Modal */}
      <SetupWizard open={showSetupWizard} onClose={() => setShowSetupWizard(false)} />
    </div>
  );
}
