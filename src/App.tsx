import { useState, useEffect } from "react";
import { useNavigate, Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import HeaderBar from "./components/HeaderBar";
import Dashboard from "./pages/Dashboard";
import SetupWizard from "./pages/SetupWizard";
import Launcher from "./pages/Launcher";
import SettingsPage from "./pages/SettingsPage";
import About from "./pages/About";
import { invoke } from "./utils/api";

type WizardInitialMode = "welcome" | "advanced";

interface WizardState {
  open: boolean;
  /** Which screen the wizard should show first on open.
   *  - "welcome"  : first-run default (§4.1.0); also used by the
   *                Dependencies page "重新运行安装向导" button so users who
   *                already have a partial setup can still re-try a full
   *                one-click automatic install (which is what most users
   *                actually want when they click this entry point).
   *  - "advanced" : used by the AutoSetup screen's mid-run "切换到高级模式"
   *                button, and by window events dispatched from error
   *                banners — both contexts imply the user has already
   *                committed to hand-tuning. */
  initialMode: WizardInitialMode;
}

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wizard, setWizard] = useState<WizardState>({ open: false, initialMode: "welcome" });
  const [checkedFirstRun, setCheckedFirstRun] = useState(false);
  const navigate = useNavigate();

  // First-run detection: if no prefix exists yet, auto-open the wizard on
  // the welcome screen (§4.1.0).
  useEffect(() => {
    async function checkFirstRun() {
      try {
        const config = await invoke("get_config");
        const prefixInfo = (await invoke("get_prefix_info", { config })) as { exists: boolean };
        if (!prefixInfo.exists) {
          setWizard({ open: true, initialMode: "welcome" });
        }
      } catch {
        // If we can't check, show wizard on welcome to be safe
        setWizard({ open: true, initialMode: "welcome" });
      } finally {
        setCheckedFirstRun(true);
      }
    }
    checkFirstRun();
  }, []);

  // Allow any descendant (e.g. Launcher error banner) to request the wizard
  // without threading callbacks through every Route/props layer. The event
  // detail may optionally specify `initialMode` — otherwise we default to
  // "advanced" since anyone dispatching this event usually already has a
  // partial setup and wants to jump straight to the 5-step wizard.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ initialMode?: WizardInitialMode }>).detail;
      setWizard({ open: true, initialMode: detail?.initialMode ?? "advanced" });
    };
    window.addEventListener("open-setup-wizard", handler);
    return () => window.removeEventListener("open-setup-wizard", handler);
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
              <Route
                path="/settings"
                element={
                  <SettingsPage
                    onOpenSetupWizard={() =>
                      setWizard({ open: true, initialMode: "welcome" })
                    }
                  />
                }
              />
              <Route path="/about" element={<About />} />
            </Routes>
          </div>
        </main>
      </div>

      {/* Setup Wizard Modal */}
      <SetupWizard
        open={wizard.open}
        initialMode={wizard.initialMode}
        onClose={() => setWizard((w) => ({ ...w, open: false }))}
        onLaunchWegame={() => {
          setWizard((w) => ({ ...w, open: false }));
          navigate("/launcher");
        }}
      />
    </div>
  );
}
