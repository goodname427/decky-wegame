/**
 * Winetricks dependency mirror & pre-seed strategy.
 *
 * PRD v1.4 §4.2.2.2 / §5.5:
 *   Winetricks normally downloads deps from Microsoft / Google / web.archive,
 *   which on SteamOS (in mainland China) routinely fails because of:
 *     - SSL cert chain issues ("certificate issuer is unknown")
 *     - IPv6 routes unreachable
 *     - Great Firewall throttling
 *
 *   We pre-seed ~/.cache/winetricks/<verb>/<filename> with files fetched from
 *   domestic mirrors BEFORE calling winetricks. When winetricks later finds
 *   the expected file with the expected size, it skips the download step
 *   entirely.
 *
 *   This file is the single source of truth for all mirror URLs. Adding a
 *   new verb mirror = just appending to MIRROR_MANIFEST.
 */

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import crypto from "crypto";
import { URL } from "url";
import { depsLogger as log } from "./logger";

/**
 * Each entry describes one downloadable file that winetricks expects to find
 * in its cache directory. `filename` MUST match exactly what the winetricks
 * verb script looks for (winetricks checks both sha256 and exact filename).
 *
 * `sources` are tried in order until one succeeds. Leave empty to force the
 * "let winetricks try its own source" path.
 *
 * `sha256` is optional — when provided, the downloaded file is validated; if
 * the check fails the file is discarded and the next source is tried.
 */
export interface MirrorEntry {
  verb: string;
  filename: string;
  sha256?: string;
  sources: string[];
  // Optional human-friendly note surfaced in logs
  note?: string;
}

// ---------------------------------------------------------------------------
// Mirror manifest
// ---------------------------------------------------------------------------
// NOTE: The URLs below MUST be verified for reachability on a real Steam Deck
// before being considered production-ready. The list starts conservative; any
// URL that fails during `fetchWithFallback` is logged and the next one is
// tried automatically, so unavailable entries are self-healing.
//
// Priority order (per PRD §4.2.2.2):
//   1. Domestic mirrors (Tencent Cloud / TUNA / USTC / HuaweiCloud)
//   2. GitHub Release asset (accessed via `ghproxy` reverse proxy)
//   3. (implicit) winetricks's own upstream — used when this table is empty
// ---------------------------------------------------------------------------

const GH_PROXIES = [
  "https://ghgo.xyz/",
  "https://mirror.ghproxy.com/",
  "https://gh.api.99988866.xyz/",
];

function ghMirrored(rawUrl: string): string[] {
  // rawUrl example: https://github.com/user/repo/releases/download/v1/file.exe
  return GH_PROXIES.map((p) => p.replace(/\/$/, "") + "/" + rawUrl);
}

/**
 * Minimal curated list. Start small — only ship entries we can verify work.
 * Anything not listed here falls back to winetricks's own download logic.
 */
export const MIRROR_MANIFEST: MirrorEntry[] = [
  // corefonts uses SourceForge which is mostly OK behind the GFW, so we don't
  // preseed it by default. It's here as a stub in case we need to override
  // later.

  // cjkfonts: upstream takwolf.github.io usually works; leave native path.

  // dotnet46 — this is the #1 reported failure from real logs
  {
    verb: "dotnet46",
    filename: "NDP46-KB3045557-x86-x64-AllOS-ENU.exe",
    // Microsoft re-published this file on its CDN many times; do NOT rely on
    // a hash here unless we are 100% sure of it. Leaving blank means we skip
    // the integrity check (winetricks will do its own check when it runs).
    sha256: "",
    sources: [
      ...ghMirrored(
        "https://github.com/goodname427/decky-wegame/releases/download/deps/NDP46-KB3045557-x86-x64-AllOS-ENU.exe"
      ),
    ],
    note: "dotnet46 installer — primary failure mode seen in production logs",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pre-seed the winetricks cache for each selected verb. Always best-effort:
 * a failure here must NOT abort the install — winetricks will still try its
 * own source afterwards. We only log warnings.
 *
 * Returns the list of verbs that were successfully pre-seeded.
 */
export async function preseedWinetricksCache(
  verbs: string[],
  opts?: { cacheRoot?: string; timeoutMs?: number }
): Promise<string[]> {
  const cacheRoot = opts?.cacheRoot ?? defaultWinetricksCacheRoot();
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const seeded: string[] = [];

  for (const verb of verbs) {
    const entries = MIRROR_MANIFEST.filter((e) => e.verb === verb);
    if (entries.length === 0) continue;

    for (const entry of entries) {
      const destDir = path.join(cacheRoot, entry.verb);
      const destPath = path.join(destDir, entry.filename);

      // Skip if already present (winetricks keeps its own cache)
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        log.info(`[mirrors] ${entry.verb}: already cached at ${destPath}`);
        seeded.push(verb);
        continue;
      }

      try {
        await fs.promises.mkdir(destDir, { recursive: true });
        const ok = await fetchWithFallback(entry, destPath, timeoutMs);
        if (ok) {
          seeded.push(verb);
          log.info(`[mirrors] ${entry.verb}: pre-seeded -> ${destPath}`);
        } else {
          log.warn(
            `[mirrors] ${entry.verb}: all mirror sources failed, will fall back to winetricks upstream`
          );
        }
      } catch (err) {
        log.warn(`[mirrors] ${entry.verb}: pre-seed error: ${err}`);
      }
    }
  }

  return seeded;
}

export function defaultWinetricksCacheRoot(): string {
  const home = process.env.HOME || "";
  return path.join(home, ".cache", "winetricks");
}

// ---------------------------------------------------------------------------
// Internal: download with failover
// ---------------------------------------------------------------------------

async function fetchWithFallback(
  entry: MirrorEntry,
  destPath: string,
  timeoutMs: number
): Promise<boolean> {
  for (const src of entry.sources) {
    const tmpPath = destPath + ".part";
    const started = Date.now();
    try {
      log.info(`[mirrors] ${entry.verb}: trying ${src}`);
      await downloadToFile(src, tmpPath, timeoutMs);

      if (entry.sha256) {
        const actual = await sha256File(tmpPath);
        if (actual.toLowerCase() !== entry.sha256.toLowerCase()) {
          log.warn(
            `[mirrors] ${entry.verb}: sha256 mismatch from ${src} (got ${actual})`
          );
          safeUnlink(tmpPath);
          continue;
        }
      }

      await fs.promises.rename(tmpPath, destPath);
      const ms = Date.now() - started;
      log.info(`[mirrors] ${entry.verb}: OK via ${src} (${ms}ms)`);
      return true;
    } catch (err) {
      log.warn(`[mirrors] ${entry.verb}: FAIL from ${src} — ${err}`);
      safeUnlink(tmpPath);
      // try next source
    }
  }
  return false;
}

function safeUnlink(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(p);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Simple HTTPS/HTTP downloader with redirect following and a hard timeout.
 * We intentionally avoid pulling in a heavy dep (node-fetch / axios) — this is
 * called at most a handful of times per install.
 */
function downloadToFile(url: string, dest: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const MAX_REDIRECTS = 5;

    const start = (currentUrl: string, redirectsLeft: number) => {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch (e) {
        reject(new Error(`invalid url: ${currentUrl}`));
        return;
      }
      const client = parsed.protocol === "http:" ? http : https;
      const req = client.get(
        currentUrl,
        {
          timeout: timeoutMs,
          headers: {
            // Some mirrors reject bare requests without a UA
            "User-Agent": "decky-wegame/1.0 (+https://github.com/goodname427/decky-wegame)",
            Accept: "*/*",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume(); // drain
            if (redirectsLeft <= 0) {
              reject(new Error(`too many redirects at ${currentUrl}`));
              return;
            }
            const next = new URL(res.headers.location, currentUrl).toString();
            start(next, redirectsLeft - 1);
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            reject(new Error(`HTTP ${status} from ${currentUrl}`));
            return;
          }

          const out = fs.createWriteStream(dest);
          res.pipe(out);
          out.on("finish", () => out.close(() => resolve()));
          out.on("error", (err) => {
            safeUnlink(dest);
            reject(err);
          });
          res.on("error", (err) => {
            safeUnlink(dest);
            reject(err);
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error(`timeout after ${timeoutMs}ms`));
      });
      req.on("error", (err) => {
        safeUnlink(dest);
        reject(err);
      });
    };

    start(url, MAX_REDIRECTS);
  });
}
