import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { ProtonInfo } from "./types";
import { expandPath } from "./environment";

/**
 * Search roots for Proton installations.
 *
 * Each entry's `kind` controls how its children are enumerated:
 *  - "compat-tools"  : every immediate subdirectory is considered a Proton
 *                      candidate (this is the classic layout used by
 *                      GE-Proton, Luxtorpeda, etc. under
 *                      `compatibilitytools.d/`).
 *  - "steam-common"  : only subdirectories whose name starts with `Proton`
 *                      are considered (this directory also contains game
 *                      installs on the same level, so we must filter).
 */
const PROTON_SEARCH_ROOTS: { path: string; kind: "compat-tools" | "steam-common" }[] = [
  // Third-party compat tools (GE-Proton, Luxtorpeda, ...) — both the legacy
  // and the XDG path that SteamOS uses at different times.
  { path: "~/.steam/root/compatibilitytools.d/", kind: "compat-tools" },
  { path: "~/.local/share/Steam/compatibilitytools.d/", kind: "compat-tools" },
  { path: "/usr/share/steam/compatibilitytools.d/", kind: "compat-tools" },
  // Valve's official Proton builds shipped by Steam itself. Each version is
  // its own directory sibling to the installed games, so we have to filter
  // by name prefix to avoid mis-identifying games as Proton tools.
  { path: "~/.steam/root/steamapps/common/", kind: "steam-common" },
  { path: "~/.local/share/Steam/steamapps/common/", kind: "steam-common" },
];

/** Valve 官方 Proton 目录名前缀（Proton 8.0 / Proton - Experimental / Proton Hotfix 等都以此开头） */
const VALVE_PROTON_DIR_PREFIX_RE = /^Proton([\s-].*)?$/i;

export function scanProtonVersions(): ProtonInfo[] {
  const versions: ProtonInfo[] = [];
  // Dedupe by resolved `proton` script path — `~/.steam/root` is usually a
  // symlink into `~/.local/share/Steam`, so the same install would otherwise
  // be enumerated twice.
  const seen = new Set<string>();

  for (const root of PROTON_SEARCH_ROOTS) {
    const basePath = expandPath(root.path);
    if (!fs.existsSync(basePath)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(basePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;

      // `steam-common` layout also contains user game directories, so we
      // must whitelist anything that looks like a Proton install.
      if (root.kind === "steam-common" && !VALVE_PROTON_DIR_PREFIX_RE.test(dirName)) {
        continue;
      }

      const protonFile = path.join(basePath, dirName, "proton");
      if (!fs.existsSync(protonFile) || !hasExecPermission(protonFile)) continue;

      let resolved: string;
      try {
        resolved = fs.realpathSync(protonFile);
      } catch {
        resolved = protonFile;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const version = extractProtonVersion(dirName);
      const isRecommended = isGeProton(dirName);

      versions.push({
        name: dirName,
        version,
        path: protonFile,
        is_recommended: isRecommended,
      });
    }
  }

  // Sort: GE-Proton first (still the recommended default for WeGame), then
  // Valve official Proton, then everything else; within each bucket sort by
  // version descending so the newest shows up at the top of the dropdown.
  versions.sort((a, b) => {
    const bucket = (v: ProtonInfo) => {
      if (v.is_recommended) return 0;
      if (/^Proton([\s-]|$)/i.test(v.name)) return 1;
      return 2;
    };
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });

  return versions;
}

function extractProtonVersion(name: string): string {
  const cleaned = name
    .replace("GE-Proton", "")
    .replace(/^Proton[\s-]*/i, "")
    .replace(/-/g, ".")
    .trim();

  if (!cleaned || !/^\d/.test(cleaned)) {
    // Keep non-numeric labels like "Experimental" / "Hotfix" readable.
    return name;
  }
  return cleaned;
}

function isGeProton(name: string): boolean {
  return name.toLowerCase().startsWith("ge-proton");
}

function hasExecPermission(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function getDefaultProtonPath(
  versions: ProtonInfo[]
): string | undefined {
  const recommended = versions.find((v) => v.is_recommended);
  return recommended?.path || versions[0]?.path;
}

export function validateProtonPath(protonPath: string): boolean {
  const expanded = expandPath(protonPath);
  if (!fs.existsSync(expanded)) return false;

  try {
    execSync(`"${expanded}" --version`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

export function checkWinetricksAvailable(): boolean {
  try {
    execSync("which winetricks", { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

export function checkWineAvailable(): boolean {
  const candidates = ["wine64", "wine"];
  for (const cmd of candidates) {
    try {
      execSync(`which ${cmd}`, { encoding: "utf-8" });
      return true;
    } catch {
      // continue
    }
  }
  return false;
}
