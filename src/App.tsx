import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import HeaderBar from "./components/HeaderBar";
import Dashboard from "./pages/Dashboard";
import SetupWizard from "./pages/SetupWizard";
import Dependencies from "./pages/Dependencies";
import Launcher from "./pages/Launcher";
import Settings from "./pages/Settings";
import About from "./pages/About";

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-dark">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <HeaderBar onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 pt-[60px]">
          <div className="mx-auto max-w-7xl animate-fade-in">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/setup" element={<SetupWizard />} />
              <Route path="/dependencies" element={<Dependencies />} />
              <Route path="/launcher" element={<Launcher />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<About />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
