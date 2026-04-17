import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { ProtonInfo } from "./types";
import { expandPath } from "./environment";

const PROTON_SEARCH_PATHS = [
  "~/.steam/root/compatibilitytools.d/",
  "~/.local/share/Steam/compatibilitytools.d/",
  "/usr/share/steam/compatibilitytools.d/",
];

export function scanProtonVersions(): ProtonInfo[] {
  const versions: ProtonInfo[] = [];

  for (const basePathStr of PROTON_SEARCH_PATHS) {
    const basePath = expandPath(basePathStr);
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
      const protonFile = path.join(basePath, dirName, "proton");

      if (fs.existsSync(protonFile) && hasExecPermission(protonFile)) {
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
  }

  // Sort: recommended first, then by version descending
  versions.sort((a, b) => {
    if (a.is_recommended && !b.is_recommended) return -1;
    if (!a.is_recommended && b.is_recommended) return 1;
    return b.version.localeCompare(a.version);
  });

  return versions;
}

function extractProtonVersion(name: string): string {
  const cleaned = name
    .replace("GE-Proton", "")
    .replace("Proton-", "")
    .replace(/-/g, ".")
    .trim();

  if (!cleaned || !/^\d/.test(cleaned)) {
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
