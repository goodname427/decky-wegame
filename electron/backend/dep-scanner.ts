import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { expandPath } from "./environment";

/**
 * Represents a single found path for a system dependency.
 */
export interface ScannedPath {
  path: string;
  version?: string;
  source: string; // e.g. "system PATH", "flatpak", "manual"
}

/**
 * Result of scanning for a specific dependency.
 */
export interface DependencyScanResult {
  id: string;
  name: string;
  description: string;
  found: boolean;
  paths: ScannedPath[];
  install_hint: string;
  download_url?: string;
}

// Common search locations on SteamOS / Arch Linux
const WINE_SEARCH_PATHS = [
  "/usr/bin/wine64",
  "/usr/bin/wine",
  "/usr/local/bin/wine64",
  "/usr/local/bin/wine",
  "~/.local/bin/wine64",
  "~/.local/bin/wine",
  // Flatpak Steam bundled wine
  "~/.var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d/*/files/bin/wine64",
  // Proton bundled wine
  "~/.steam/root/compatibilitytools.d/*/files/bin/wine64",
  "~/.local/share/Steam/compatibilitytools.d/*/files/bin/wine64",
  "~/.steam/root/steamapps/common/Proton*/files/bin/wine64",
  "~/.local/share/Steam/steamapps/common/Proton*/files/bin/wine64",
];

const WINETRICKS_SEARCH_PATHS = [
  "/usr/bin/winetricks",
  "/usr/local/bin/winetricks",
  "~/.local/bin/winetricks",
  "/usr/share/winetricks/winetricks",
];

/**
 * Resolve glob-like patterns in paths (supports single * wildcard in directory names).
 */
function resolveGlobPaths(pattern: string): string[] {
  const expanded = expandPath(pattern);
  if (!expanded.includes("*")) {
    return fs.existsSync(expanded) ? [expanded] : [];
  }

  // Split at the first wildcard segment
  const parts = expanded.split("/");
  let basePath = "";
  let globIdx = -1;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes("*")) {
      globIdx = i;
      break;
    }
    basePath += (i === 0 ? "" : "/") + parts[i];
  }

  if (globIdx === -1 || !basePath) return [];
  if (!fs.existsSync(basePath)) return [];

  const globPattern = parts[globIdx];
  const restParts = parts.slice(globIdx + 1);

  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!matchGlob(entry.name, globPattern)) continue;

      const candidate = [basePath, entry.name, ...restParts].join("/");
      if (fs.existsSync(candidate)) {
        results.push(candidate);
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Simple glob matching: supports * as wildcard for any characters.
 */
function matchGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );
  return regex.test(name);
}

/**
 * Try to get the version string of a binary.
 */
function getVersion(binPath: string, args: string = "--version"): string | undefined {
  try {
    const output = execSync(`"${binPath}" ${args} 2>&1`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    // Extract first line, trim to reasonable length
    const firstLine = output.split("\n")[0].trim();
    return firstLine.length > 100 ? firstLine.substring(0, 100) + "..." : firstLine;
  } catch {
    return undefined;
  }
}

/**
 * Determine the source label for a found path.
 */
function getSourceLabel(filePath: string): string {
  if (filePath.includes("flatpak") || filePath.includes(".var/app")) {
    return "Flatpak";
  }
  if (filePath.includes("compatibilitytools.d") || filePath.includes("Proton")) {
    return "Proton 内置";
  }
  if (filePath.includes("steamapps/common")) {
    return "Steam 内置";
  }
  if (filePath.includes(".local/bin")) {
    return "用户目录";
  }
  if (filePath.startsWith("/usr/local")) {
    return "本地安装";
  }
  if (filePath.startsWith("/usr")) {
    return "系统安装";
  }
  return "其他";
}

/**
 * Check if a file is executable.
 */
function isExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Also try `which` command to find binaries in PATH.
 */
function findInPath(command: string): string[] {
  const results: string[] = [];
  try {
    // Use `which -a` to find all matches
    const output = execSync(`which -a ${command} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && fs.existsSync(trimmed)) {
        results.push(trimmed);
      }
    }
  } catch {
    // Not found in PATH
  }
  return results;
}

/**
 * Scan for Wine installations on the system.
 */
export function scanWinePaths(): DependencyScanResult {
  const found = new Map<string, ScannedPath>();

  // Search via which command first
  for (const cmd of ["wine64", "wine"]) {
    for (const p of findInPath(cmd)) {
      const realPath = fs.realpathSync(p);
      if (!found.has(realPath)) {
        found.set(realPath, {
          path: p,
          version: getVersion(p),
          source: getSourceLabel(p),
        });
      }
    }
  }

  // Search known paths
  for (const pattern of WINE_SEARCH_PATHS) {
    for (const p of resolveGlobPaths(pattern)) {
      if (!isExecutable(p)) continue;
      const realPath = fs.realpathSync(p);
      if (!found.has(realPath)) {
        found.set(realPath, {
          path: p,
          version: getVersion(p),
          source: getSourceLabel(p),
        });
      }
    }
  }

  const paths = Array.from(found.values());

  return {
    id: "wine",
    name: "Wine",
    description: "Windows 兼容层，运行 Windows 程序的核心组件",
    found: paths.length > 0,
    paths,
    install_hint: "sudo pacman -S wine  # Arch/SteamOS\n# 或者 Wine 通常由 Proton 内置提供",
    download_url: "https://wiki.winehq.org/Download",
  };
}

/**
 * Scan for winetricks installations on the system.
 */
export function scanWinetricksPaths(): DependencyScanResult {
  const found = new Map<string, ScannedPath>();

  // Search via which command
  for (const p of findInPath("winetricks")) {
    const realPath = fs.realpathSync(p);
    if (!found.has(realPath)) {
      found.set(realPath, {
        path: p,
        version: getVersion(p),
        source: getSourceLabel(p),
      });
    }
  }

  // Search known paths
  for (const pattern of WINETRICKS_SEARCH_PATHS) {
    for (const p of resolveGlobPaths(pattern)) {
      if (!isExecutable(p)) continue;
      const realPath = fs.realpathSync(p);
      if (!found.has(realPath)) {
        found.set(realPath, {
          path: p,
          version: getVersion(p),
          source: getSourceLabel(p),
        });
      }
    }
  }

  const paths = Array.from(found.values());

  return {
    id: "winetricks",
    name: "winetricks",
    description: "Wine 辅助工具，用于安装 Windows 运行时依赖（.NET、VC++ 等）",
    found: paths.length > 0,
    paths,
    install_hint:
      "# 方式一：包管理器安装（SteamOS 需先解锁只读）\nsudo steamos-readonly disable\nsudo pacman -Sy winetricks\nsudo steamos-readonly enable\n\n# 方式二：直接下载脚本（无需 root）\nmkdir -p ~/.local/bin\ncurl -L https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks -o ~/.local/bin/winetricks\nchmod +x ~/.local/bin/winetricks",
    download_url: "https://github.com/Winetricks/winetricks",
  };
}

/**
 * Scan all system dependencies at once.
 */
export function scanAllDependencies(): DependencyScanResult[] {
  return [scanWinePaths(), scanWinetricksPaths()];
}

/**
 * Validate a user-provided custom path for a dependency.
 */
export function validateDependencyPath(depId: string, customPath: string): ScannedPath | null {
  const expanded = expandPath(customPath);
  if (!fs.existsSync(expanded)) return null;
  if (!isExecutable(expanded)) return null;

  const version = getVersion(expanded);

  // Basic sanity check: try running with --version or --help
  if (depId === "wine") {
    try {
      execSync(`"${expanded}" --version 2>&1`, { encoding: "utf-8", timeout: 5000 });
    } catch {
      return null;
    }
  } else if (depId === "winetricks") {
    try {
      execSync(`"${expanded}" --version 2>&1`, { encoding: "utf-8", timeout: 5000 });
    } catch {
      return null;
    }
  }

  return {
    path: expanded,
    version,
    source: "自定义路径",
  };
}
