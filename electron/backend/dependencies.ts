import { spawn } from "child_process";
import { DependencyItem, DependencyCategory, InstallProgress, LogPayload } from "./types";

interface DependencyDef {
  id: string;
  name: string;
  category: DependencyCategory;
  description: string;
  size_mb: number;
  required: boolean;
}

const DEPENDENCY_DEFINITIONS: DependencyDef[] = [
  { id: "dotnet46", name: ".NET Framework 4.6", category: "dotnet", description: "WeGame core runtime dependency", size_mb: 180, required: true },
  { id: "dotnet48", name: ".NET Framework 4.8", category: "dotnet", description: "Latest .NET Framework runtime (recommended)", size_mb: 200, required: true },
  { id: "vcpp2005", name: "Visual C++ 2005 Redistributable", category: "vcpp", description: "VC++ runtime for legacy components", size_mb: 6, required: false },
  { id: "vcpp2008", name: "Visual C++ 2008 Redistributable", category: "vcpp", description: "Game component dependency", size_mb: 9, required: true },
  { id: "vcpp2010", name: "Visual C++ 2010 Redistributable", category: "vcpp", description: "Widely used VC++ runtime", size_mb: 11, required: true },
  { id: "vcpp2012", name: "Visual C++ 2012 Redistributable", category: "vcpp", description: "Game and tool dependency", size_mb: 12, required: true },
  { id: "vcpp2013", name: "Visual C++ 2013 Redistributable", category: "vcpp", description: "Common VC++ runtime", size_mb: 13, required: true },
  { id: "vcpp2015-2022", name: "Visual C++ 2015-2022 (x64)", category: "vcpp", description: "Latest VC++ runtime bundle", size_mb: 35, required: true },
  { id: "font-microsoft-core", name: "Microsoft Core Fonts", category: "font", description: "Arial, Times New Roman and other base fonts", size_mb: 8, required: true },
  { id: "font-cjk", name: "CJK Support Fonts (CJKfonts)", category: "font", description: "CJK font support, fixes garbled Chinese text", size_mb: 25, required: true },
  { id: "ie8", name: "Internet Explorer 8", category: "browser", description: "IE kernel for WeGame embedded browser", size_mb: 150, required: true },
  { id: "gdiplus", name: "GDI+ (gdiplus)", category: "system", description: "Windows Graphics Device Interface library", size_mb: 3, required: true },
  { id: "mscoree", name: ".NET Core Runtime (mscoree)", category: "system", description: ".NET Framework core execution engine", size_mb: 2, required: true },
  { id: "directx9", name: "DirectX 9.0c (d3dx9)", category: "system", description: "DirectX 9 runtime library", size_mb: 50, required: true },
  { id: "vcrun6", name: "Visual Basic 6 Runtime (vcrun6)", category: "other", description: "VB6 runtime compatibility layer", size_mb: 5, required: false },
];

const WINETRICKS_ID_MAP: Record<string, string> = {
  "dotnet46": "dotnet46",
  "dotnet48": "dotnet48",
  "vcpp2005": "vcrun2005",
  "vcpp2008": "vcrun2008",
  "vcpp2010": "vcrun2010",
  "vcpp2012": "vcrun2012",
  "vcpp2013": "vcrun2013",
  "vcpp2015-2022": "vcrun2022",
  "font-microsoft-core": "corefonts",
  "font-cjk": "cjkfonts",
  "ie8": "ie8",
  "gdiplus": "gdiplus",
  "mscoree": "mscoree",
  "directx9": "d3dx9",
  "vcrun6": "vcrun6",
};

function winetricksId(depId: string): string {
  return WINETRICKS_ID_MAP[depId] || depId;
}

export function getDependencyList(): DependencyItem[] {
  return DEPENDENCY_DEFINITIONS.map((def) => ({
    ...def,
    installed: false,
    install_time: undefined,
  }));
}

export interface ProgressEmitter {
  emitProgress: (progress: InstallProgress) => void;
  emitLog: (log: LogPayload) => void;
}

export async function installDependencies(
  winePrefixPath: string,
  selectedIds: string[],
  emitter: ProgressEmitter
): Promise<void> {
  const total = selectedIds.length;
  let completed = 0;

  for (let idx = 0; idx < selectedIds.length; idx++) {
    const depId = selectedIds[idx];
    const wtId = winetricksId(depId);

    emitter.emitProgress({
      current_dependency: depId,
      current_step: `Installing ${wtId}...`,
      progress_percent: Math.round((idx / total) * 100),
      total_steps: total,
      completed_steps: completed,
      status: "running",
    });

    try {
      await runWinetricksSingle(winePrefixPath, wtId, emitter);
      completed++;
      emitter.emitProgress({
        current_dependency: depId,
        current_step: "Completed",
        progress_percent: Math.round((completed / total) * 100),
        total_steps: total,
        completed_steps: completed,
        status: "idle",
      });
    } catch (err) {
      emitter.emitProgress({
        current_dependency: depId,
        current_step: "Failed",
        progress_percent: 0,
        total_steps: total,
        completed_steps: completed,
        status: "error",
        error_message: String(err),
      });
    }
  }

  emitter.emitProgress({
    current_dependency: "",
    current_step: "All dependencies installed",
    progress_percent: 100,
    total_steps: total,
    completed_steps: total,
    status: "completed",
  });
}

function runWinetricksSingle(
  prefixPath: string,
  wtId: string,
  emitter: ProgressEmitter
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("winetricks", ["-q", "--unattended", wtId], {
      env: { ...process.env, WINEPREFIX: prefixPath, DISPLAY: ":0" },
    });

    let output = "";

    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          output += trimmed + "\n";
          const now = new Date();
          const ts = now.toTimeString().slice(0, 8) + "." + String(now.getMilliseconds()).padStart(3, "0");
          emitter.emitLog({ level: "info", message: trimmed, timestamp: ts });
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          const now = new Date();
          const ts = now.toTimeString().slice(0, 8) + "." + String(now.getMilliseconds()).padStart(3, "0");
          emitter.emitLog({ level: "warn", message: trimmed, timestamp: ts });
        }
      }
    });

    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`winetricks ${wtId} failed with exit code: ${code}`));
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run winetricks: ${err.message}`));
    });
  });
}
