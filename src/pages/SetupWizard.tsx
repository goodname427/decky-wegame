import { useState, useEffect } from "react";
import { invoke, installWinetricks, startInstallDependencies } from "../utils/api";
import { ChevronLeft, ChevronRight, Check, Zap, Rocket, X, AlertTriangle, RefreshCw, CheckCircle, XCircle, Loader2, Download, Edit3, ExternalLink, SkipForward } from "lucide-react";
import ProgressBar from "../components/ProgressBar";
import useEnvironment, { useProtonVersions } from "../hooks/useEnvironment";
import useInstallProgress from "../hooks/useInstallProgress";
import LogViewer from "../components/LogViewer";
import ConfirmDialog from "../components/ConfirmDialog";
import type { EnvironmentConfig, DependencyCategory } from "../types";
import { DEPENDENCY_LIST } from "../utils/constants";

const STEPS = [
  { id: 1, title: "扫描依赖", icon: ShieldCheck },
  { id: 2, title: "选择 Proton", icon: Cpu },
  { id: 3, title: "配置路径", icon: FolderCog },
  { id: 4, title: "确认依赖", icon: ListChecks },
  { id: 5, title: "执行安装", icon: Rocket },
];

function Cpu({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 7h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z" /></svg>;
}
function FolderCog({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15a3 3 0 100-6 3 3 0 000 6zm0 0V8m0 7h.01M8.5 11H5m13.5 0h-3.5" /></svg>;
}
function ListChecks({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
}
function RocketIcon({ className }: { className?: string }) {
  return <Rocket className={className || ""} />;
}
function ShieldCheck({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
}

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
}

export default function SetupWizard({ open, onClose }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [localConfig, setLocalConfig] = useState<EnvironmentConfig | null>(null);
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [showGlobalSkipConfirm, setShowGlobalSkipConfirm] = useState(false);
  const [globalSkipped, setGlobalSkipped] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // Dependency scan state
  interface ScannedPath {
    path: string;
    version?: string;
    source: string;
  }
  interface DepScanResult {
    id: string;
    name: string;
    description: string;
    found: boolean;
    paths: ScannedPath[];
    install_hint: string;
    download_url?: string;
  }
  type DepSelection = "scanned" | "custom" | "download";
  interface DepState {
    scanResult: DepScanResult | null;
    selection: DepSelection;
    selectedPathIdx: number;
    customPath: string;
    customValidating: boolean;
    customValid: boolean | null;
    customError?: string;
  }
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [depStates, setDepStates] = useState<Record<string, DepState>>({});

  const { versions: protonVersions, loading: protonLoading } = useProtonVersions();
  const { config, systemInfo, saveEnvironment } = useEnvironment();
  const { progress, logs } = useInstallProgress();

  // Initialize local config once
  const initializedRef = useState(false);
  if (!initializedRef[0] && config) {
    initializedRef[1](true);
    setLocalConfig(config);
    setSelectedDeps(DEPENDENCY_LIST.filter((d) => d.required).map((d) => d.id));
  }

  // Run dependency scan when wizard opens
  useEffect(() => {
    if (open && !scanned && !scanning) {
      runScan();
    }
  }, [open]);

  async function runScan() {
    setScanning(true);
    try {
      const results = (await invoke("scan_system_dependencies")) as DepScanResult[];
      const newStates: Record<string, DepState> = {};
      for (const r of results) {
        newStates[r.id] = {
          scanResult: r,
          selection: r.found ? "scanned" : "download",
          selectedPathIdx: 0,
          customPath: "",
          customValidating: false,
          customValid: null,
        };
      }
      setDepStates(newStates);
      setScanned(true);
    } catch {
      setScanned(true);
    } finally {
      setScanning(false);
    }
  }

  function updateDepState(depId: string, partial: Partial<DepState>) {
    setDepStates((prev) => ({
      ...prev,
      [depId]: { ...prev[depId], ...partial },
    }));
  }

  async function validateCustomPath(depId: string, path: string) {
    updateDepState(depId, { customValidating: true, customValid: null, customError: undefined });
    try {
      const result = await invoke("validate_dependency_path", { depId, path });
      if (result) {
        updateDepState(depId, { customValidating: false, customValid: true });
      } else {
        updateDepState(depId, { customValidating: false, customValid: false, customError: "路径无效或文件不可执行" });
      }
    } catch {
      updateDepState(depId, { customValidating: false, customValid: false, customError: "验证失败" });
    }
  }

  function isDepReady(depId: string): boolean {
    const state = depStates[depId];
    if (!state) return false;
    if (state.selection === "scanned" && state.scanResult?.found) return true;
    if (state.selection === "custom" && state.customValid === true) return true;
    if (state.selection === "download") return true; // User chose to download later
    return false;
  }

  if (!open || !localConfig) return null;

  const totalSteps = STEPS.length;

  // Allow closing only when not installing
  const canClose = !installing && progress.status !== "running";

  function updateConfig(partial: Partial<EnvironmentConfig>) {
    setLocalConfig((prev) => ({ ...prev!, ...partial }));
  }

  async function handleFinish() {
    setInstalling(true);
    try {
      await saveEnvironment(localConfig!);
      // Init prefix first
      await invoke("init_environment", { config: localConfig });
      // Install dependencies or skip
      if (globalSkipped) {
        // Skip entire wizard
        await invoke("skip_dependency_installation", { config: localConfig });
      } else if (skippedInstall) {
        // Skip only dependency installation
        await invoke("skip_dependency_installation", { config: localConfig });
      } else {
        // Check if we need sudo permissions for winetricks
        const systemInfo = await invoke("get_system_info");
        if (!systemInfo.winetricks_available) {
          // Show password dialog for winetricks installation
          setShowPasswordDialog(true);
          return; // Wait for password input
        }
        await startInstallDependencies(localConfig, selectedDeps);
      }
    } catch (err) {
      console.error("Setup failed:", err);
    }
    setInstalling(false);
  }

  async function handlePasswordSubmit() {
    if (!password.trim()) {
      setPasswordError("请输入密码");
      return;
    }
    
    setPasswordError("");
    setShowPasswordDialog(false);
    
    try {
      // First install winetricks with password
      await installWinetricks(password);
      // Then start dependency installation
      await startInstallDependencies(localConfig, selectedDeps);
    } catch (err) {
      console.error("Installation failed:", err);
      // Show password dialog again if authentication failed
      if (err.message && err.message.includes("密码错误")) {
        setPasswordError("密码错误，请重新输入");
      } else {
        setPasswordError("安装失败，请重试");
      }
      setShowPasswordDialog(true);
    }
    
    setPassword("");
  }

  async function handleGlobalSkipWizard() {
    setShowGlobalSkipConfirm(false);
    setGlobalSkipped(true);
    // Skip entire wizard and close it
    await invoke("skip_dependency_installation", { config: localConfig });
    onClose();
  }

  function canProceed() {
    switch (currentStep) {
      case 1: {
        // All deps must be resolved (scanned+selected, custom+valid, or download)
        const depIds = Object.keys(depStates);
        if (depIds.length === 0) return false;
        return depIds.every((id) => isDepReady(id));
      }
      case 2: return true; // Proton auto-selects if none chosen
      case 3: return (localConfig?.wine_prefix_path?.length ?? 0) > 0;
      case 4: return selectedDeps.length > 0;
      default: return true;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={canClose ? onClose : undefined}
      />

      {/* Modal content */}
      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-surface-dark p-6 shadow-2xl mx-4">
        {/* Close button */}
        {canClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        <div className="space-y-6">
      {/* Step Indicator */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between">
          {STEPS.map((step, idx) => (
            <div key={step.id} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-300 ${
                    step.id === currentStep
                      ? "border-primary bg-primary/20 text-primary scale-110"
                      : step.id < currentStep
                        ? "border-neon-green bg-neon-green/20 text-neon-green"
                        : "border-white/10 text-gray-500"
                  }`}
                >
                  {step.id < currentStep ? <Check className="h-4 w-4" /> : step.id}
                </div>
                <span
                  className={`text-[11px] font-medium ${
                    step.id === currentStep ? "text-primary" : step.id < currentStep ? "text-neon-green" : "text-gray-500"
                  }`}
                >
                  {step.title}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`mx-2 h-[2px] flex-1 rounded-full transition-colors duration-300 ${
                    currentStep > step.id ? "bg-primary/40" : "bg-white/5"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="glass-card p-6 animate-fade-in min-h-[320px]">
        {currentStep === 1 && (
          <div className="space-y-5">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-100">扫描系统依赖</h3>
              <p className="mt-1 text-sm text-gray-400">自动扫描系统中已有的 Wine 和 winetricks，也可以手动指定路径或选择下载安装。</p>
            </div>

            {scanning ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <span className="text-sm text-gray-400">正在扫描系统依赖...</span>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.values(depStates).map((state) => {
                  const dep = state.scanResult;
                  if (!dep) return null;
                  const ready = isDepReady(dep.id);

                  return (
                    <div key={dep.id} className={`rounded-lg border overflow-hidden ${
                      ready ? "border-neon-green/20" : "border-white/10"
                    }`}>
                      {/* Header */}
                      <div className={`flex items-center gap-3 px-4 py-3 ${
                        ready ? "bg-neon-green/5" : "bg-white/[0.02]"
                      }`}>
                        {ready ? (
                          <CheckCircle className="h-5 w-5 text-neon-green shrink-0" />
                        ) : (
                          <XCircle className="h-5 w-5 text-gray-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-gray-200">{dep.name}</h4>
                          <p className="text-xs text-gray-500">{dep.description}</p>
                        </div>
                      </div>

                      <div className="px-4 py-3 space-y-2">
                        {/* Scanned paths */}
                        {dep.found && dep.paths.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">扫描到的路径</span>
                            {dep.paths.map((p, idx) => (
                              <button
                                key={idx}
                                onClick={() => updateDepState(dep.id, { selection: "scanned", selectedPathIdx: idx })}
                                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all border ${
                                  state.selection === "scanned" && state.selectedPathIdx === idx
                                    ? "border-primary/50 bg-primary/8 ring-1 ring-primary/30"
                                    : "border-white/5 hover:bg-white/5"
                                }`}
                              >
                                <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                                  state.selection === "scanned" && state.selectedPathIdx === idx
                                    ? "bg-primary shadow-sm shadow-primary/50"
                                    : "bg-gray-600"
                                }`} />
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-mono text-gray-300 block truncate">{p.path}</span>
                                  <span className="text-[10px] text-gray-500">
                                    {p.source}{p.version ? ` · ${p.version}` : ""}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Not found hint */}
                        {!dep.found && (
                          <div className="flex items-start gap-2 rounded-lg border border-neon-yellow/20 bg-neon-yellow/5 p-2.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-neon-yellow mt-0.5 shrink-0" />
                            <p className="text-xs text-gray-400">未在系统中扫描到 {dep.name}，请选择自定义路径或下载安装。</p>
                          </div>
                        )}

                        {/* Divider */}
                        {dep.found && <div className="border-t border-white/5 my-1" />}

                        {/* Custom path option */}
                        <button
                          onClick={() => updateDepState(dep.id, { selection: "custom" })}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all border ${
                            state.selection === "custom"
                              ? "border-accent/50 bg-accent/8 ring-1 ring-accent/30"
                              : "border-white/5 hover:bg-white/5"
                          }`}
                        >
                          <Edit3 className={`h-3.5 w-3.5 shrink-0 ${
                            state.selection === "custom" ? "text-accent" : "text-gray-500"
                          }`} />
                          <span className={`text-xs font-medium ${
                            state.selection === "custom" ? "text-accent" : "text-gray-400"
                          }`}>自定义路径</span>
                        </button>

                        {/* Custom path input */}
                        {state.selection === "custom" && (
                          <div className="ml-6 space-y-2">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={state.customPath}
                                onChange={(e) => updateDepState(dep.id, { customPath: e.target.value, customValid: null })}
                                placeholder={`输入 ${dep.name} 可执行文件的完整路径`}
                                className="flex-1 rounded-lg border border-white/10 bg-surface-light/60 px-3 py-1.5 text-xs text-gray-200 font-mono focus:border-primary/40 focus:outline-none"
                              />
                              <button
                                onClick={() => validateCustomPath(dep.id, state.customPath)}
                                disabled={!state.customPath.trim() || state.customValidating}
                                className="neon-secondary text-xs px-3 py-1.5 shrink-0 disabled:opacity-30"
                              >
                                {state.customValidating ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : "验证"}
                              </button>
                            </div>
                            {state.customValid === true && (
                              <p className="text-xs text-neon-green flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" /> 路径有效
                              </p>
                            )}
                            {state.customValid === false && (
                              <p className="text-xs text-neon-red flex items-center gap-1">
                                <XCircle className="h-3 w-3" /> {state.customError || "路径无效"}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Download option */}
                        <button
                          onClick={() => updateDepState(dep.id, { selection: "download" })}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all border ${
                            state.selection === "download"
                              ? "border-neon-yellow/50 bg-neon-yellow/8 ring-1 ring-neon-yellow/30"
                              : "border-white/5 hover:bg-white/5"
                          }`}
                        >
                          <Download className={`h-3.5 w-3.5 shrink-0 ${
                            state.selection === "download" ? "text-neon-yellow" : "text-gray-500"
                          }`} />
                          <div className="flex-1">
                            <span className={`text-xs font-medium ${
                              state.selection === "download" ? "text-neon-yellow" : "text-gray-400"
                            }`}>下载安装</span>
                          </div>
                          {dep.download_url && (
                            <a
                              href={dep.download_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] text-gray-500 hover:text-primary flex items-center gap-0.5"
                            >
                              <ExternalLink className="h-2.5 w-2.5" /> 查看
                            </a>
                          )}
                        </button>

                        {/* Download install hint */}
                        {state.selection === "download" && dep.install_hint && (
                          <div className="ml-6 rounded bg-surface-dark/80 p-2.5 text-xs text-gray-400 font-mono whitespace-pre-wrap leading-relaxed max-h-[120px] overflow-y-auto">
                            {dep.install_hint}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Re-scan button */}
                <button
                  onClick={() => { setScanned(false); runScan(); }}
                  className="neon-secondary flex items-center gap-2 text-sm"
                >
                  <RefreshCw className="h-4 w-4" />
                  重新扫描
                </button>
              </div>
            )}
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-100">选择 Proton 兼容层</h3>
              <p className="mt-1 text-sm text-gray-400">选择用于运行 WeGame 的 Proton 版本。推荐使用 GE-Proton 以获得最佳兼容性。</p>
            </div>

            {protonLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">正在扫描可用版本...</div>
            ) : protonVersions.length === 0 ? (
              <div className="rounded-lg border border-neon-yellow/20 bg-neon-yellow/5 p-4 text-sm text-gray-300">
                未检测到任何 Proton 版本。请先安装 GE-Proton 到以下目录之一：
                <ul className="mt-2 ml-4 list-disc space-y-1 text-xs text-gray-400">
                  <li>~/.steam/root/compatibilitytools.d/</li>
                  <li>~/.local/share/Steam/compatibilitytools.d/</li>
                </ul>
              </div>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-2">
                {protonVersions.map((ver) => (
                  <button
                    key={ver.path}
                    onClick={() => updateConfig({ proton_path: ver.path })}
                    className={`w-full flex items-center justify-between rounded-lg px-4 py-3 text-left transition-all ${
                      localConfig.proton_path === ver.path
                        ? "border-primary/50 bg-primary/8 ring-1 ring-primary/30"
                        : "border-white/5 hover:bg-white/5"
                    } border`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-3 w-3 rounded-full ${localConfig.proton_path === ver.path ? "bg-primary shadow-sm shadow-primary/50" : "bg-gray-600"}`} />
                      <div>
                        <span className={`font-medium ${localConfig.proton_path === ver.path ? "text-primary" : "text-gray-200"}`}>
                          {ver.name}
                        </span>
                        {ver.is_recommended && (
                          <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">推荐</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">{ver.version}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => {
                if (protonVersions.length > 0 && !localConfig.proton_path) {
                  updateConfig({ proton_path: protonVersions[0].path });
                }
              }}
              disabled={protonVersions.length === 0}
              className="neon-secondary flex items-center gap-2 text-sm mt-2"
            >
              <Zap className="h-4 w-4" />
              自动推荐最佳版本
            </button>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-5">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-100">配置路径</h3>
              <p className="mt-1 text-sm text-gray-400">设置 Wine 前缀和 WeGame 安装路径。通常使用默认值即可。</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Wine 前缀路径</label>
              <input
                type="text"
                value={localConfig.wine_prefix_path}
                onChange={(e) => updateConfig({ wine_prefix_path: e.target.value })}
                placeholder="~/.local/share/decky-wegame/prefix"
                className="input-field font-mono text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Wine 将在此目录创建 Windows 兼容环境（建议保持默认）</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">WeGame 安装路径</label>
              <input
                type="text"
                value={localConfig.wegame_install_path}
                onChange={(e) => updateConfig({ wegame_install_path: e.target.value })}
                placeholder="Wine 前缀内的 WeGame 安装目录"
                className="input-field font-mono text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">安装 WeGame 后的路径，通常自动检测无需修改</p>
            </div>

            <div className="rounded-lg border border-white/5 bg-surface-dark/60 p-3">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>目标分区剩余空间</span>
                <span className="font-mono text-gray-300">{systemInfo?.free_disk_gb.toFixed(1) ?? "--"} GB 可用</span>
              </div>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-100">确认要安装的依赖组件</h3>
              <p className="mt-1 text-sm text-gray-400">勾选需要安装的 Windows 运行时组件。标记为「必需」的组件建议全部安装。</p>
            </div>

            {(["dotnet", "vcpp", "font", "browser", "system", "other"] as const).map((cat) => {
              const catNames: Record<string, string> = {
                dotnet: ".NET Framework",
                vcpp: "Visual C++ 运行时",
                font: "字体支持",
                browser: "浏览器组件",
                system: "系统组件",
                other: "其他组件",
              };

              const catDeps = DEPENDENCY_LIST.filter((d) => d.category === cat as DependencyCategory);

              if (catDeps.length === 0) return null;

              const allChecked = catDeps.every((d) => selectedDeps.includes(d.id));

              return (
                <div key={cat} className="rounded-lg border border-white/5 overflow-hidden">
                  <button
                    onClick={() => {
                      if (allChecked) {
                        setSelectedDeps(selectedDeps.filter((id) => !catDeps.some((d) => d.id === id)));
                      } else {
                        setSelectedDeps([...new Set([...selectedDeps, ...catDeps.map((d) => d.id)])]);
                      }
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                  >
                    <span className="text-sm font-semibold text-gray-200">{catNames[cat]}</span>
                    <span className="text-xs text-gray-500">
                      {selectedDeps.filter((id) => catDeps.some((d) => d.id === id)).length} / {catDeps.length}
                    </span>
                  </button>
                  <div className="divide-y divide-white/5">
                    {catDeps.map((dep) => (
                      <label key={dep.id} className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02] transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedDeps.includes(dep.id)}
                          onChange={(e) => {
                            if ((e.target as HTMLInputElement).checked) {
                              setSelectedDeps([...selectedDeps, dep.id]);
                            } else {
                              setSelectedDeps(selectedDeps.filter((id) => id !== dep.id));
                            }
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-gray-600 text-primary focus:ring-primary/30"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-200">{dep.name}</span>
                            {dep.required && (
                              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">必需</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">{dep.description}</p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-600 tabular-nums">{dep.size_mb} MB</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between rounded-lg bg-primary/5 border border-primary/10 px-4 py-3">
              <span className="text-sm text-gray-300">已选择 <strong className="text-primary">{selectedDeps.length}</strong> 个依赖项</span>
              <span className="text-xs text-gray-500">
                预计占用 ~{(selectedDeps.length * 45).toFixed(0)} MB
              </span>
            </div>
            

        {currentStep === 5 && (
          <div className="space-y-5">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-100">开始安装</h3>
              <p className="mt-1 text-sm text-gray-400">点击下方按钮开始创建环境和安装依赖组件。</p>
            </div>

            {!installing && progress.status !== "completed" && progress.status !== "running" && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleFinish}
                  disabled={!canProceed()}
                  className="neon-primary text-base px-10 py-3.5 flex items-center gap-2"
                >
                  <RocketIcon />
                  开始安装
                </button>
              </div>
            )}

            {(installing || progress.status === "running") && (
              <div className="space-y-4 pt-2">
                <ProgressBar
                  percent={progress.progress_percent}
                  label={
                    progress.current_dependency
                      ? `正在安装: ${progress.current_dependency}`
                      : "准备中..."
                  }
                />
                <div className="text-center text-xs text-gray-400">
                  步骤 {progress.completed_steps + 1} / {progress.total_steps || selectedDeps.length} ·
                  {progress.current_step && ` ${progress.current_step}`}
                </div>
              </div>
            )}

            {progress.status === "completed" && (
              <div className="rounded-lg border border-neon-green/20 bg-neon-green/5 p-6 text-center">
                <Check className="mx-auto mb-3 h-10 w-10 text-neon-green" />
                <h4 className="font-semibold text-neon-green">安装完成！</h4>
                <p className="mt-1 text-sm text-gray-400">所有依赖已成功安装到 Wine 环境中。</p>
              </div>
            )}

            {logs.length > 0 && (
              <div className="pt-2">
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">安装日志</h4>
                <LogViewer logs={logs} maxHeight="220px" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGlobalSkipConfirm(true)}
            className="neon-secondary flex items-center gap-1.5 text-sm"
          >
            <SkipForward className="h-4 w-4" />
            跳过向导
          </button>
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="neon-secondary flex items-center gap-1.5 text-sm disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            上一步
          </button>
        </div>

        <div className="text-xs text-gray-500">
          步骤 {currentStep} / {totalSteps}
        </div>

        <div className="flex items-center gap-2">
          {progress.status === "completed" && (
            <button
              onClick={onClose}
              className="neon-primary flex items-center gap-1.5 text-sm"
            >
              完成
            </button>
          )}
          {currentStep < totalSteps && progress.status !== "completed" ? (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              disabled={!canProceed()}
              className="neon-primary flex items-center gap-1.5 text-sm disabled:opacity-30"
            >
              下一步
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
        </div>
      </div>

      {/* Global skip wizard confirm dialog */}
      <ConfirmDialog
        open={showGlobalSkipConfirm}
        title="跳过整个安装向导"
        message="这将跳过整个安装向导，包括环境配置、Proton选择、依赖安装等所有步骤。系统将使用默认配置，但可能影响 WeGame 的正常运行。确定要跳过吗？"
        confirmText="确认跳过"
        onConfirm={handleGlobalSkipWizard}
        onCancel={() => setShowGlobalSkipConfirm(false)}
      />

      {/* Password input dialog */}
      <div className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${showPasswordDialog ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPasswordDialog(false)} />
        <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-surface-dark p-6 shadow-2xl mx-4">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-100">需要管理员权限</h3>
            <p className="mt-1 text-sm text-gray-400">
              安装 winetricks 需要管理员权限。请输入您的密码以继续安装过程。
            </p>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError("");
                }}
                placeholder="请输入您的密码"
                className={`w-full px-3 py-2 rounded-lg border bg-white/5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 ${
                  passwordError ? "border-red-500 focus:ring-red-500" : "border-white/10 focus:ring-primary"
                }`}
                autoFocus
              />
              {passwordError && (
                <p className="mt-1 text-xs text-red-400">{passwordError}</p>
              )}
            </div>
            
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowPasswordDialog(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
