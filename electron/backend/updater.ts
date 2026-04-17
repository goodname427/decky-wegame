import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";

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

function httpsGet(url: string, headers?: Record<string, string>): Promise<{ statusCode: number; data: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = {
      "User-Agent": "WeGame-Launcher-Updater",
      ...headers,
    };

    const makeRequest = (requestUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      const parsedUrl = new URL(requestUrl);
      const protocol = parsedUrl.protocol === "https:" ? https : http;

      const req = protocol.get(requestUrl, { headers: reqHeaders }, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }

        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            data,
            headers: res.headers as Record<string, string>,
          });
        });
      });

      req.on("error", reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
    };

    makeRequest(url, 0);
  });
}

/**
 * Check for updates from GitHub Releases (stable channel).
 */
async function checkStableUpdate(): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  try {
    const response = await httpsGet(url, {
      Accept: "application/vnd.github.v3+json",
    });

    if (response.statusCode === 404) {
      // No releases yet
      return {
        has_update: false,
        current_version: currentVersion,
        latest_version: currentVersion,
        channel: "stable",
      };
    }

    if (response.statusCode !== 200) {
      throw new Error(`GitHub API returned status ${response.statusCode}`);
    }

    const release = JSON.parse(response.data);
    const latestVersion = (release.tag_name || "").replace(/^v/, "");

    // Find AppImage asset
    const appImageAsset = (release.assets || []).find(
      (a: { name: string }) => a.name.endsWith(".AppImage")
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
    const response = await httpsGet(url, {
      Accept: "application/vnd.github.v3+json",
    });

    if (response.statusCode !== 200) {
      throw new Error(`GitHub API returned status ${response.statusCode}`);
    }

    const data = JSON.parse(response.data);
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
      const artifactsResponse = await httpsGet(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/artifacts`,
        { Accept: "application/vnd.github.v3+json" }
      );
      if (artifactsResponse.statusCode === 200) {
        const artifactsData = JSON.parse(artifactsResponse.data);
        const appImageArtifact = (artifactsData.artifacts || []).find(
          (a: { name: string }) => a.name.includes("AppImage")
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

  return new Promise((resolve, reject) => {
    const makeRequest = (url: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === "https:" ? https : http;

      protocol.get(url, {
        headers: { "User-Agent": "WeGame-Launcher-Updater" },
      }, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;

        const fileStream = fs.createWriteStream(filePath);

        res.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (onProgress && totalSize > 0) {
            onProgress({
              percent: Math.round((downloaded / totalSize) * 100),
              downloaded,
              total: totalSize,
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          // Make executable
          fs.chmodSync(filePath, 0o755);
          resolve(filePath);
        });

        fileStream.on("error", (err) => {
          fs.unlinkSync(filePath);
          reject(err);
        });
      }).on("error", reject);
    };

    makeRequest(downloadUrl, 0);
  });
}
