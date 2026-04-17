import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { EnvironmentConfig } from "./types";

export function expandPath(p: string): string {
  if (p.startsWith("~")) {
    const home = process.env.HOME || "/home/deck";
    return path.join(home, p.slice(1));
  }
  // Handle $HOME and other env vars
  return p.replace(/\$(\w+)/g, (_, name) => process.env[name] || "");
}

export function getPrefixPath(config: EnvironmentConfig): string {
  return expandPath(config.wine_prefix_path);
}

export function prefixExists(config: EnvironmentConfig): boolean {
  const prefixPath = getPrefixPath(config);
  return (
    fs.existsSync(prefixPath) &&
    fs.existsSync(path.join(prefixPath, "drive_c")) &&
    fs.existsSync(path.join(prefixPath, "system.reg"))
  );
}

export function getPrefixSizeMb(config: EnvironmentConfig): number {
  const prefixPath = getPrefixPath(config);
  if (!fs.existsSync(prefixPath)) return 0;

  try {
    const output = execSync(
      `du -sm --exclude=drive_c/users "${prefixPath}"`,
      { encoding: "utf-8" }
    );
    const parts = output.trim().split(/\s+/);
    return parseFloat(parts[0]) || 0;
  } catch {
    return 0;
  }
}

export async function createPrefix(
  config: EnvironmentConfig
): Promise<string> {
  const prefixPath = getPrefixPath(config);
  if (fs.existsSync(prefixPath)) {
    return `Wine Prefix already exists at: ${prefixPath}`;
  }

  fs.mkdirSync(prefixPath, { recursive: true });

  const wineCmd = findWineCommand();

  return new Promise((resolve, reject) => {
    const child = spawn(wineCmd, ["boot"], {
      cwd: prefixPath,
      env: {
        ...process.env,
        WINEPREFIX: prefixPath,
        WINEDLLOVERRIDES: "mscoree=n",
        DISPLAY: ":0",
      },
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(`Wine Prefix created successfully at: ${prefixPath}`);
      } else {
        reject(new Error(`wine boot failed with exit code: ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run wine boot: ${err.message}`));
    });
  });
}

export async function deletePrefix(
  config: EnvironmentConfig
): Promise<string> {
  const prefixPath = getPrefixPath(config);
  if (!fs.existsSync(prefixPath)) {
    return "No Wine Prefix found to delete.";
  }

  fs.rmSync(prefixPath, { recursive: true, force: true });
  return `Wine Prefix deleted successfully from: ${prefixPath}`;
}

function findWineCommand(): string {
  const candidates = ["wine64", "wine"];
  for (const cmd of candidates) {
    try {
      execSync(`which ${cmd}`, { encoding: "utf-8" });
      return cmd;
    } catch {
      // continue
    }
  }
  throw new Error("Could not find wine or wine64 in PATH");
}
