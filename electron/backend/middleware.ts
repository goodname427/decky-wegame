import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { spawn } from "child_process";
import { expandPath } from "./environment";

// Only user-writable Proton directories are allowed for delete/install
const USER_PROTON_DIRS = [
  "~/.steam/root/compatibilitytools.d",
  "~/.local/share/Steam/compatibilitytools.d",
];

function getPrimaryProtonInstallDir(): string {
  for (const dir of USER_PROTON_DIRS) {
    const expanded = expandPath(dir);
    // Prefer an existing one; otherwise create the first candidate
    if (fs.existsSync(expanded)) return expanded;
  }
  const fallback = expandPath(USER_PROTON_DIRS[0]);
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

/**
 * Delete a Proton version by directory path.
 * Only paths under the user's Steam compatibilitytools.d folders are allowed.
 */
export function deleteProtonVersion(protonPath: string): { success: boolean; error?: string } {
  try {
    // The stored proton path is the proton executable; resolve the containing dir
    const expanded = expandPath(protonPath);
    let targetDir = expanded;
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      targetDir = path.dirname(expanded);
    }
    // Only allow deletion under user dirs
    const allowedRoots = USER_PROTON_DIRS.map((p) => expandPath(p));
    const isAllowed = allowedRoots.some((root) => targetDir.startsWith(root + path.sep) || path.dirname(targetDir) === root);
    if (!isAllowed) {
      return { success: false, error: "仅允许删除用户目录下的 Proton 版本（~/.steam/root/compatibilitytools.d/ 或 ~/.local/share/Steam/compatibilitytools.d/）" };
    }
    if (!fs.existsSync(targetDir)) {
      return { success: false, error: "目标目录不存在" };
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// --- GE-Proton download & install ---

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  assets: GithubAsset[];
  published_at: string;
  body: string;
}

function httpsGetJson(url: string): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const make = (u: string, depth: number) => {
      if (depth > 5) return reject(new Error("Too many redirects"));
      const parsed = new URL(u);
      const proto = parsed.protocol === "https:" ? https : http;
      const req = proto.get(u, { headers: { "User-Agent": "WeGame-Launcher", Accept: "application/vnd.github.v3+json" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          make(res.headers.location, depth + 1);
          return;
        }
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => resolve({ statusCode: res.statusCode || 0, data }));
      });
      req.on("error", reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error("Request timeout")); });
    };
    make(url, 0);
  });
}

/**
 * Fetch latest GE-Proton release info from GitHub.
 */
export async function fetchLatestGeProtonInfo(): Promise<{ version: string; downloadUrl: string; fileName: string; size: number; publishedAt: string; }> {
  const url = "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest";
  const res = await httpsGetJson(url);
  if (res.statusCode !== 200) {
    throw new Error(`GitHub API returned status ${res.statusCode}`);
  }
  const release: GithubRelease = JSON.parse(res.data);
  // Prefer .tar.gz (smaller, more standard). Fallback to .tar.xz
  const asset =
    release.assets.find((a) => a.name.endsWith(".tar.gz")) ||
    release.assets.find((a) => a.name.endsWith(".tar.xz"));
  if (!asset) {
    throw new Error("No Proton tarball asset found in latest release");
  }
  return {
    version: release.tag_name,
    downloadUrl: asset.browser_download_url,
    fileName: asset.name,
    size: asset.size,
    publishedAt: release.published_at,
  };
}

function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (p: { percent: number; downloaded: number; total: number }) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const make = (u: string, depth: number) => {
      if (depth > 5) return reject(new Error("Too many redirects"));
      const parsed = new URL(u);
      const proto = parsed.protocol === "https:" ? https : http;
      proto.get(u, { headers: { "User-Agent": "WeGame-Launcher" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          make(res.headers.location, depth + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        const ws = fs.createWriteStream(destPath);
        res.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (onProgress && total > 0) {
            onProgress({ percent: Math.round((downloaded / total) * 100), downloaded, total });
          }
        });
        res.pipe(ws);
        ws.on("finish", () => { ws.close(); resolve(); });
        ws.on("error", (err) => { try { fs.unlinkSync(destPath); } catch { /* ignore */ } reject(err); });
      }).on("error", reject);
    };
    make(url, 0);
  });
}

function extractTarball(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = tarPath.endsWith(".tar.xz") ? ["-xJf", tarPath, "-C", destDir] : ["-xzf", tarPath, "-C", destDir];
    const child = spawn("tar", args);
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}: ${stderr}`));
    });
    child.on("error", reject);
  });
}

/**
 * Download and install the latest GE-Proton release into the user's
 * Steam compatibilitytools.d directory.
 *
 * Progress phases:
 *  - "download": 0-90%
 *  - "extract":  90-100%
 */
export async function downloadAndInstallGeProton(
  onProgress?: (p: { phase: "download" | "extract" | "done"; percent: number; message?: string }) => void
): Promise<{ success: boolean; version?: string; installPath?: string; error?: string }> {
  try {
    onProgress?.({ phase: "download", percent: 0, message: "获取最新 GE-Proton 版本信息..." });
    const info = await fetchLatestGeProtonInfo();

    const installDir = getPrimaryProtonInstallDir();
    const tmpDir = path.join(installDir, ".download-tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    const tarPath = path.join(tmpDir, info.fileName);

    onProgress?.({ phase: "download", percent: 1, message: `正在下载 ${info.version}...` });

    await downloadToFile(info.downloadUrl, tarPath, (p) => {
      // Map 0-100 of download into 1-90
      const mapped = 1 + Math.round(p.percent * 0.89);
      onProgress?.({ phase: "download", percent: mapped, message: `下载中 ${p.percent}%` });
    });

    onProgress?.({ phase: "extract", percent: 92, message: "正在解压..." });
    await extractTarball(tarPath, installDir);

    // Clean up temp file
    try { fs.unlinkSync(tarPath); fs.rmdirSync(tmpDir); } catch { /* ignore */ }

    onProgress?.({ phase: "done", percent: 100, message: `GE-Proton ${info.version} 已安装` });

    return { success: true, version: info.version, installPath: installDir };
  } catch (err) {
    onProgress?.({ phase: "done", percent: 100, message: `安装失败: ${(err as Error).message}` });
    return { success: false, error: (err as Error).message };
  }
}

// --- winetricks install (no sudo: download script to ~/.local/bin) ---

/**
 * Install winetricks by downloading the script to ~/.local/bin/winetricks (no sudo required).
 */
export async function installWinetricksUserlocal(): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const binDir = expandPath("~/.local/bin");
    fs.mkdirSync(binDir, { recursive: true });
    const dest = path.join(binDir, "winetricks");
    const url = "https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks";
    await downloadToFile(url, dest);
    fs.chmodSync(dest, 0o755);
    return { success: true, path: dest };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
