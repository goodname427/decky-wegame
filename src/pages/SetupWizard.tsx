import { useState } from "react";
import { invoke } from "../utils/api";
import { ChevronLeft, ChevronRight, Check, Zap, Rocket } from "lucide-react";
import ProgressBar from "../components/ProgressBar";
import useEnvironment, { useProtonVersions } from "../hooks/useEnvironment";
import useInstallProgress from "../hooks/useInstallProgress";
import LogViewer from "../components/LogViewer";
import type { EnvironmentConfig, DependencyCategory } from "../types";
import { DEPENDENCY_LIST } from "../utils/constants";

const STEPS = [
  { id: 1, title: "选择 Proton", icon: Cpu },
  { id: 2, title: "配置路径", icon: FolderCog },
  { id: 3, title: "确认依赖", icon: ListChecks },
  { id: 4, title: "执行安装", icon: Rocket },
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

export default function SetupWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [localConfig, setLocalConfig] = useState<EnvironmentConfig | null>(null);
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);

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

  if (!localConfig) return null;

  const totalSteps = STEPS.length;

  function updateConfig(partial: Partial<EnvironmentConfig>) {
    setLocalConfig((prev) => ({ ...prev!, ...partial }));
  }

  async function handleFinish() {
    setInstalling(true);
    try {
      await saveEnvironment(localConfig!);
      // Init prefix first
      await invoke("init_environment", { config: localConfig });
      // Install dependencies
      await invoke("start_install_dependencies", { selectedIds: selectedDeps, config: localConfig });
    } catch (err) {
      console.error("Setup failed:", err);
    }
    setInstalling(false);
  }

  function canProceed() {
    switch (currentStep) {
      case 1: return true; // Proton auto-selects if none chosen
      case 2: return (localConfig?.wine_prefix_path?.length ?? 0) > 0;
      case 3: return selectedDeps.length > 0;
      default: return true;
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
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

        {currentStep === 2 && (
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

        {currentStep === 3 && (
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
          </div>
        )}

        {currentStep === 4 && (
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
        <button
          onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
          disabled={currentStep === 1}
          className="neon-secondary flex items-center gap-1.5 text-sm disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
          上一步
        </button>

        <div className="text-xs text-gray-500">
          步骤 {currentStep} / {totalSteps}
        </div>

        {currentStep < totalSteps ? (
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
  );
}
