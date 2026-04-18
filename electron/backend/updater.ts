import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  downloadFromMirrorPool,
  httpGetJsonFromPool,
  ghMirrored,
} from "./mirrors";

export type UpdateChannel = "stable" | "dev";

export interface UpdateInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  channel: UpdateChannel;
  release_notes?: string;
  download_url?: string;
  file_name?: string;
  published_at?: string;
  html_url?: string;
}

// GitHub repository info
const GITHUB_OWNER = "goodname427";
const GITHUB_REPO = "decky-wegame";

function getCurrentVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Compare two semver strings. Returns:
 *  1 if a > b
 *  0 if a == b
 * -1 if a < b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * GET a GitHub JSON endpoint via the shared mirror pool so the self-updater
 * works from inside the GFW without a user-configured proxy.
 */
async function githubApiGet(rawUrl: string): Promise<{ statusCode: number; data: unknown }> {
  const res = await httpGetJsonFromPool("github-api", ghMirrored(rawUrl), {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "WeGame-Launcher-Updater",
    },
    acceptNotFound: true,
  });
  if (!res.ok) {
    throw new Error(
      `GitHub API 所有镜像均失败（${res.triedUrls.length} 个源）：${res.errors.slice(0, 3).join("; ")}`
    );
  }
  return { statusCode: res.status, data: res.data };
}

/**
 * Check for updates from GitHub Releases (stable channel).
 */
async function checkStableUpdate(): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  try {
    const response = await githubApiGet(url);

    if (response.statusCode === 404 || !response.data) {
      // No releases yet
      return {
        has_update: false,
        current_version: currentVersion,
        latest_version: currentVersion,
        channel: "stable",
      };
    }

    const release = response.data as {
      tag_name?: string;
      body?: string;
      published_at?: string;
      html_url?: string;
      assets?: { name: string; browser_download_url: string }[];
    };
    const latestVersion = (release.tag_name || "").replace(/^v/, "");

    // Find AppImage asset
    const appImageAsset = (release.assets || []).find(
      (a) => a.name.endsWith(".AppImage")
    );

    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

    return {
      has_update: hasUpdate,
      current_version: currentVersion,
      latest_version: latestVersion,
      channel: "stable",
      release_notes: release.body || "",
      download_url: appImageAsset?.browser_download_url,
      file_name: appImageAsset?.name,
      published_at: release.published_at,
      html_url: release.html_url,
    };
  } catch (err) {
    throw new Error(`Failed to check for stable updates: ${(err as Error).message}`);
  }
}

/**
 * Check for updates from GitHub Actions (dev channel).
 * Compares the latest successful workflow run's commit with the current build.
 */
async function checkDevUpdate(): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs?status=success&per_page=1&branch=main`;

  try {
    const response = await githubApiGet(url);

    if (response.statusCode !== 200 || !response.data) {
      throw new Error(`GitHub API returned status ${response.statusCode}`);
    }

    const data = response.data as {
      workflow_runs?: {
        id: number;
        head_sha?: string;
        head_branch?: string;
        head_commit?: { message?: string };
        created_at?: string;
      }[];
    };
    const runs = data.workflow_runs || [];

    if (runs.length === 0) {
      return {
        has_update: false,
        current_version: currentVersion,
        latest_version: currentVersion,
        channel: "dev",
      };
    }

    const latestRun = runs[0];
    const runId = latestRun.id;
    const headSha = latestRun.head_sha || "";
    const shortSha = headSha.substring(0, 7);

    // Get current git commit if available
    let currentSha = "";
    try {
      currentSha = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
        cwd: path.join(__dirname, "../.."),
      }).trim();
    } catch {
      // Not a git repo or git not available - always show as update available
    }

    const hasUpdate = !currentSha || currentSha !== headSha;

    // Get artifacts for this run
    let downloadUrl: string | undefined;
    let fileName: string | undefined;
    try {
      const artifactsResponse = await githubApiGet(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/artifacts`
      );
      if (artifactsResponse.statusCode === 200 && artifactsResponse.data) {
        const artifactsData = artifactsResponse.data as {
          artifacts?: { name: string }[];
        };
        const appImageArtifact = (artifactsData.artifacts || []).find(
          (a) => a.name.includes("AppImage")
        );
        if (appImageArtifact) {
          // Note: Artifact downloads require authentication, so we provide the HTML URL
          downloadUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`;
          fileName = appImageArtifact.name;
        }
      }
    } catch {
      // Artifacts info is optional
    }

    return {
      has_update: hasUpdate,
      current_version: `${currentVersion} (${currentSha ? currentSha.substring(0, 7) : "unknown"})`,
      latest_version: `${currentVersion}-dev (${shortSha})`,
      channel: "dev",
      release_notes: `Commit: ${latestRun.head_commit?.message || headSha}\nBranch: ${latestRun.head_branch || "main"}`,
      download_url: downloadUrl,
      file_name: fileName,
      published_at: latestRun.created_at,
      html_url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`,
    };
  } catch (err) {
    throw new Error(`Failed to check for dev updates: ${(err as Error).message}`);
  }
}

/**
 * Check for updates on the specified channel.
 */
export async function checkForUpdate(channel: UpdateChannel): Promise<UpdateInfo> {
  if (channel === "stable") {
    return checkStableUpdate();
  } else {
    return checkDevUpdate();
  }
}

/**
 * Download an update file and replace the current AppImage.
 * Only works for stable channel with direct download URLs.
 */
export async function downloadAndInstallUpdate(
  downloadUrl: string,
  fileName: string,
  onProgress?: (progress: { percent: number; downloaded: number; total: number }) => void
): Promise<string> {
  const downloadDir = path.join(
    process.env.HOME || "/home/deck",
    ".local/share/decky-wegame/updates"
  );
  fs.mkdirSync(downloadDir, { recursive: true });

  const filePath = path.join(downloadDir, fileName);

  const dl = await downloadFromMirrorPool(
    "github-release",
    ghMirrored(downloadUrl),
    {
      destPath: filePath,
      // App self-update AppImage is tens of MB; reject tiny proxy error pages.
      minBytes: 10_000_000,
      timeoutMs: 10 * 60_000,
      userAgent: "WeGame-Launcher-Updater",
      onProgress,
    }
  );

  if (!dl.ok) {
    throw new Error(
      `应用更新下载失败（${dl.triedUrls.length} 个镜像均不可用）：${dl.errors.slice(0, 3).join("; ")}`
    );
  }

  // Make executable
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // non-fatal on platforms that ignore chmod
  }
  return filePath;
}
