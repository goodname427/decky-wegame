import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { expandPath } from "./environment";
import {
  downloadFromMirrorPool,
  httpGetJsonFromPool,
  ghMirrored,
} from "./mirrors";

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

/**
 * Fetch latest GE-Proton release info from GitHub. Goes through the shared
 * mirror pool so it works from inside the GFW without a proxy.
 */
export async function fetchLatestGeProtonInfo(): Promise<{ version: string; downloadUrl: string; fileName: string; size: number; publishedAt: string; }> {
  const rawUrl = "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest";
  const res = await httpGetJsonFromPool("github-api", ghMirrored(rawUrl), {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub API 所有镜像均失败（${res.triedUrls.length} 个源）：${res.errors.join("; ")}`
    );
  }
  const release = res.data as GithubRelease | null;
  if (!release) {
    throw new Error("GitHub 返回空 release（可能仓库尚无发布版本）");
  }
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

    const dl = await downloadFromMirrorPool(
      "github-release",
      ghMirrored(info.downloadUrl),
      {
        destPath: tarPath,
        // Real GE-Proton tarballs are 300+ MB; anything smaller is a 404 HTML
        // body slipping through. 50 MB keeps headroom for slimmer releases.
        minBytes: 50_000_000,
        timeoutMs: 10 * 60_000,
        onProgress: (p) => {
          // Map 0-100 of download into 1-90
          const mapped = 1 + Math.round(p.percent * 0.89);
          onProgress?.({ phase: "download", percent: mapped, message: `下载中 ${p.percent}%（源：${new URL(p.sourceUrl).host}）` });
        },
      }
    );
    if (!dl.ok) {
      throw new Error(
        `GE-Proton 下载失败（尝试了 ${dl.triedUrls.length} 个镜像）：${dl.errors.slice(0, 3).join("; ")}`
      );
    }

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
    const rawUrl = "https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks";
    const dl = await downloadFromMirrorPool(
      "github-raw",
      ghMirrored(rawUrl),
      {
        destPath: dest,
        // winetricks script is a single shell file around 1 MB; set a loose
        // lower bound to reject proxies that return a tiny HTML error page.
        minBytes: 100_000,
        timeoutMs: 60_000,
      }
    );
    if (!dl.ok) {
      return {
        success: false,
        error: `winetricks 脚本下载失败（${dl.triedUrls.length} 个镜像均不可用）：${dl.errors.slice(0, 3).join("; ")}`,
      };
    }
    fs.chmodSync(dest, 0o755);
    return { success: true, path: dest };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
