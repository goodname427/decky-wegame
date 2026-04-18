/**
 * Centralized mirror / download subsystem.
 *
 * Why this file exists:
 *   Any code in this app that needs to fetch something from the Internet
 *   (GE-Proton tarballs, winetricks script, WeGame installer, application
 *   self-update, winetricks verb caches, GitHub Release metadata, ...) MUST
 *   go through here. We do not allow `https.get` or `fetch` to a hardcoded
 *   URL scattered across the codebase — PRD §5.6.5 treats that as a bug.
 *
 *   This module provides three primitives:
 *
 *     downloadFromMirrorPool(poolId, candidates, opts)
 *       Downloads a binary file to disk. HEAD-probes each candidate first
 *       (opt-out), then streams the first candidate that looks healthy.
 *       Returns a discriminated union — never throws — so business code
 *       can branch on {ok: true/false} and surface a useful UI message.
 *
 *     httpGetJsonFromPool(poolId, candidates, opts)
 *       Same failover semantics but returns a parsed JSON body instead of
 *       writing to disk. Used for GitHub Release / workflow APIs.
 *
 *     expandMirrorCandidates(poolId, rawUrl?, extra?)
 *       Resolves a poolId into an ordered candidate URL list by consulting
 *       mirror-manifest.json. For GitHub-backed pools this means prepending
 *       every githubProxies.prefixes entry to `rawUrl`; for static pools
 *       this means returning the static candidates list verbatim. User
 *       overrides (`extra`) always land at the front.
 *
 *   Every attempt is logged under Log.category("Mirror") in the format
 *     [Mirror] <poolId> trying [i/N] <url>
 *     [Mirror] <poolId> HEAD <status> <ms>ms <url>
 *     [Mirror] <poolId> FAIL <url>: <reason>
 *     [Mirror] <poolId> OK via <url> (<bytes>B, <ms>ms)
 *   so a single grep answers "which mirror actually served this download".
 *
 *   Manifest is loaded at compile time via `resolveJsonModule` — the JSON
 *   file doubles as documentation; URL rot is expected and patching the
 *   manifest does not require bumping MINOR (per PRD §5.6.5).
 */

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import crypto from "crypto";
import { URL } from "url";
import { Log } from "./logger";
// Statically-imported manifest. Bundler inlines this into the compiled JS,
// so the .json file does not need to exist at runtime.
import manifestRaw from "./mirror-manifest.json";

const log = Log.category("Mirror");

// ---------------------------------------------------------------------------
// Manifest types & accessors
// ---------------------------------------------------------------------------

interface GithubProxiesSpec {
  prefixes: string[];
  trailingOriginal: boolean;
}

type PoolSpec =
  | { strategy: "github-prefix" }
  | { strategy: "static"; candidates: string[] };

interface WinetricksVerbEntry {
  verb: string;
  filename: string;
  sha256: string;
  sources: string[];
  note?: string;
}

interface MirrorManifest {
  githubProxies: GithubProxiesSpec;
  pools: Record<string, PoolSpec>;
  winetricksVerbs: { entries: WinetricksVerbEntry[] };
}

// Cast through `unknown` — the JSON has a `_meta` / `_comment` noise field we
// don't model in the types.
const MANIFEST = manifestRaw as unknown as MirrorManifest;

/**
 * Return the ordered list of GitHub accelerator prefixes, followed by an
 * empty string (= original URL) if trailingOriginal is true. Exported only
 * so that callers that already have a raw URL can use `ghMirrored()` for
 * convenience.
 */
export function ghProxies(): string[] {
  const arr = [...(MANIFEST.githubProxies.prefixes ?? [])];
  if (MANIFEST.githubProxies.trailingOriginal) arr.push("");
  return arr;
}

/**
 * Expand a raw GitHub URL into the full candidate list by prefixing each
 * accelerator. Example:
 *   ghMirrored("https://github.com/foo/bar/releases/download/v1/x.tar.gz")
 *     => [
 *       "https://gh-proxy.com/https://github.com/foo/bar/...",
 *       "https://ghproxy.net/https://github.com/foo/bar/...",
 *       ...,
 *       "https://github.com/foo/bar/...",   // trailingOriginal
 *     ]
 */
export function ghMirrored(rawUrl: string): string[] {
  return ghProxies().map((p) =>
    p ? p.replace(/\/$/, "") + "/" + rawUrl : rawUrl
  );
}

/**
 * Resolve a poolId into an ordered candidate URL list.
 *
 * Rules:
 *   - github-* pools: `rawUrl` is required and gets expanded via ghMirrored.
 *   - static pools (e.g. wegame-installer): `rawUrl` is ignored; the manifest's
 *     `candidates[]` is returned verbatim.
 *   - `extra` is always inserted at the front (highest priority) and deduped.
 *
 * Unknown poolId throws — that's a programming error, not a runtime failure.
 */
export function expandMirrorCandidates(
  poolId: string,
  rawUrl?: string,
  extra?: string[]
): string[] {
  const spec = MANIFEST.pools[poolId];
  if (!spec) {
    throw new Error(
      `[mirrors] unknown poolId="${poolId}". Register it in mirror-manifest.json first.`
    );
  }

  let base: string[];
  if (spec.strategy === "github-prefix") {
    if (!rawUrl) {
      throw new Error(
        `[mirrors] pool "${poolId}" (github-prefix) requires a rawUrl`
      );
    }
    base = ghMirrored(rawUrl);
  } else {
    // "static"
    base = [...spec.candidates];
  }

  const out: string[] = [];
  const push = (u: string | undefined): void => {
    if (!u) return;
    const trimmed = u.trim();
    if (!trimmed) return;
    if (!out.includes(trimmed)) out.push(trimmed);
  };
  (extra ?? []).forEach(push);
  base.forEach(push);
  return out;
}

// ---------------------------------------------------------------------------
// Public API — downloadFromMirrorPool
// ---------------------------------------------------------------------------

export interface DownloadProgress {
  percent: number;
  downloaded: number;
  total: number;
  /** 0-based index into the candidate list that actually served the bytes. */
  sourceIndex: number;
  /** Full URL (after ghMirrored expansion) being downloaded from. */
  sourceUrl: string;
}

export interface DownloadOptions {
  destPath: string;
  /** Per-request timeout in ms. Default: 60_000 */
  timeoutMs?: number;
  /**
   * Minimum acceptable file size after download. Smaller = treat as failure
   * and try next candidate. Default: 1 byte (just "must be non-empty").
   * WeGame-installer callers should pass 1_000_000 to reject tiny 404 HTML
   * bodies that got through.
   */
  minBytes?: number;
  /** If provided, validate sha256 after download; mismatch = try next. */
  sha256?: string;
  /**
   * If true, issue a HEAD first and skip candidates that return non-2xx or
   * a Content-Length below minBytes. Default: true. Some gh-proxy mirrors
   * disallow HEAD; callers that know this should pass false.
   */
  probeHead?: boolean;
  /** Override User-Agent. Default: "decky-wegame/<ver>". */
  userAgent?: string;
  onProgress?: (p: DownloadProgress) => void;
}

export type DownloadResult =
  | { ok: true; sourceUrl: string; sourceIndex: number; triedUrls: string[]; bytes: number }
  | { ok: false; triedUrls: string[]; errors: string[] };

const DEFAULT_UA = "decky-wegame/1.x (+https://github.com/goodname427/decky-wegame)";

/**
 * Try each candidate URL in order; first one that (optionally HEAD-probes
 * OK, then) downloads successfully wins. Never throws.
 */
export async function downloadFromMirrorPool(
  poolId: string,
  candidates: string[],
  opts: DownloadOptions
): Promise<DownloadResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const minBytes = opts.minBytes ?? 1;
  const probeHead = opts.probeHead ?? true;
  const userAgent = opts.userAgent ?? DEFAULT_UA;
  const triedUrls: string[] = [];
  const errors: string[] = [];

  if (candidates.length === 0) {
    log.warn(`${poolId}: no candidates provided, aborting`);
    return { ok: false, triedUrls, errors: ["no candidates provided"] };
  }

  // Ensure destination directory exists so we can stream straight into it.
  try {
    fs.mkdirSync(path.dirname(opts.destPath), { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`mkdir ${opts.destPath} failed: ${msg}`);
    log.error(`${poolId}: mkdir failed: ${msg}`);
    return { ok: false, triedUrls, errors };
  }

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    triedUrls.push(url);
    log.log(`${poolId} trying [${i + 1}/${candidates.length}] ${url}`);

    // ------ HEAD probe (best-effort) ------
    if (probeHead) {
      const probeStart = Date.now();
      const probe = await probeUrl(url, Math.min(timeoutMs, 10_000), userAgent);
      const probeMs = Date.now() - probeStart;
      log.verbose(
        `${poolId} HEAD ${probe.statusCode} ${probeMs}ms len=${probe.contentLength} ${url}`
      );
      const probeAcceptable =
        probe.statusCode >= 200 &&
        probe.statusCode < 300 &&
        (probe.contentLength === 0 || probe.contentLength >= minBytes);
      if (!probeAcceptable) {
        const reason = `HEAD ${probe.statusCode} len=${probe.contentLength}`;
        log.warn(`${poolId} FAIL ${url}: ${reason}`);
        errors.push(`${url} -> ${reason}`);
        continue;
      }
    }

    // ------ Actual download ------
    const tmpPath = opts.destPath + ".part";
    const started = Date.now();
    try {
      safeUnlink(tmpPath); // clear any previous .part from a failed attempt
      const bytes = await streamToFile(url, tmpPath, timeoutMs, userAgent, (p) => {
        opts.onProgress?.({
          percent: p.percent,
          downloaded: p.downloaded,
          total: p.total,
          sourceIndex: i,
          sourceUrl: url,
        });
      });

      if (bytes < minBytes) {
        const reason = `too small (${bytes} < ${minBytes})`;
        log.warn(`${poolId} FAIL ${url}: ${reason}`);
        safeUnlink(tmpPath);
        errors.push(`${url} -> ${reason}`);
        continue;
      }

      if (opts.sha256) {
        const actual = await sha256File(tmpPath);
        if (actual.toLowerCase() !== opts.sha256.toLowerCase()) {
          const reason = `sha256 mismatch (got ${actual})`;
          log.warn(`${poolId} FAIL ${url}: ${reason}`);
          safeUnlink(tmpPath);
          errors.push(`${url} -> ${reason}`);
          continue;
        }
      }

      // Commit .part -> final path atomically.
      fs.renameSync(tmpPath, opts.destPath);
      const ms = Date.now() - started;
      log.log(`${poolId} OK via ${url} (${bytes}B, ${ms}ms)`);
      return { ok: true, sourceUrl: url, sourceIndex: i, triedUrls, bytes };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`${poolId} FAIL ${url}: ${msg}`);
      safeUnlink(tmpPath);
      errors.push(`${url} -> ${msg}`);
      // try next candidate
    }
  }

  log.error(
    `${poolId}: all ${candidates.length} candidates failed`
  );
  return { ok: false, triedUrls, errors };
}

// ---------------------------------------------------------------------------
// Public API — httpGetJsonFromPool
// ---------------------------------------------------------------------------

export type JsonResult =
  | { ok: true; sourceUrl: string; status: number; data: unknown }
  | { ok: false; triedUrls: string[]; errors: string[] };

export interface JsonGetOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /**
   * If true (default), an HTTP 404 on a candidate is treated as a real
   * answer (the resource definitively doesn't exist upstream) and returned
   * immediately instead of failing over to the next candidate. GitHub
   * Release "latest" uses 404 to mean "no releases yet" and relies on this.
   */
  acceptNotFound?: boolean;
}

/**
 * Try each candidate URL in order; first one that returns 2xx (or 404 when
 * acceptNotFound is true) wins. Response body is always parsed as JSON.
 */
export async function httpGetJsonFromPool(
  poolId: string,
  candidates: string[],
  opts?: JsonGetOptions
): Promise<JsonResult> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const acceptNotFound = opts?.acceptNotFound ?? true;
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "application/json",
    ...(opts?.headers ?? {}),
  };
  const triedUrls: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    triedUrls.push(url);
    log.log(`${poolId} JSON trying [${i + 1}/${candidates.length}] ${url}`);
    const started = Date.now();
    try {
      const res = await rawHttpGet(url, timeoutMs, headers);
      const ms = Date.now() - started;

      if (acceptNotFound && res.statusCode === 404) {
        log.log(`${poolId} JSON 404 (accepted) via ${url} (${ms}ms)`);
        return { ok: true, sourceUrl: url, status: 404, data: null };
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        const reason = `HTTP ${res.statusCode}`;
        log.warn(`${poolId} FAIL ${url}: ${reason}`);
        errors.push(`${url} -> ${reason}`);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(res.body);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`${poolId} FAIL ${url}: invalid JSON (${msg})`);
        errors.push(`${url} -> invalid JSON: ${msg}`);
        continue;
      }

      log.log(`${poolId} JSON OK via ${url} (${res.body.length}B, ${ms}ms)`);
      return { ok: true, sourceUrl: url, status: res.statusCode, data: parsed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`${poolId} FAIL ${url}: ${msg}`);
      errors.push(`${url} -> ${msg}`);
    }
  }

  log.error(`${poolId}: all ${candidates.length} JSON candidates failed`);
  return { ok: false, triedUrls, errors };
}

// ---------------------------------------------------------------------------
// Winetricks cache pre-seeding (consumes the generic downloader above)
// ---------------------------------------------------------------------------

/**
 * Pre-seed the winetricks cache for each selected verb. Always best-effort:
 * a failure here must NOT abort the install — winetricks will still try its
 * own source afterwards. We only emit warnings.
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
    const entries = MANIFEST.winetricksVerbs.entries.filter((e) => e.verb === verb);
    if (entries.length === 0) continue;

    for (const entry of entries) {
      const destDir = path.join(cacheRoot, entry.verb);
      const destPath = path.join(destDir, entry.filename);

      // Skip if already present (winetricks keeps its own cache)
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        log.log(`preseed ${entry.verb}: already cached at ${destPath}`);
        seeded.push(verb);
        continue;
      }

      if (entry.sources.length === 0) {
        log.verbose(
          `preseed ${entry.verb}: no mirrors configured, letting winetricks handle it`
        );
        continue;
      }

      const result = await downloadFromMirrorPool(
        `winetricks-${entry.verb}`,
        entry.sources,
        {
          destPath,
          timeoutMs,
          minBytes: 1_000_000,
          sha256: entry.sha256 || undefined,
          // Some upstream winetricks deps live on ancient servers that reject
          // HEAD; disable the probe to be safe.
          probeHead: false,
        }
      );

      if (result.ok) {
        seeded.push(verb);
        log.log(`preseed ${entry.verb}: -> ${destPath}`);
      } else {
        log.warn(
          `preseed ${entry.verb}: all ${result.triedUrls.length} sources failed, falling back to winetricks upstream`
        );
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
// Internal primitives
// ---------------------------------------------------------------------------

interface ProbeResult {
  statusCode: number;
  contentLength: number;
  finalUrl: string;
}

function probeUrl(
  url: string,
  timeoutMs: number,
  userAgent: string
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = (u: string, depth: number): void => {
      if (depth > 5) {
        resolve({ statusCode: 0, contentLength: 0, finalUrl: u });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        resolve({ statusCode: 0, contentLength: 0, finalUrl: u });
        return;
      }
      const proto = parsed.protocol === "https:" ? https : http;
      const req = proto.request(
        u,
        { method: "HEAD", headers: { "User-Agent": userAgent, Accept: "*/*" } },
        (res) => {
          const code = res.statusCode || 0;
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, u).toString();
            start(next, depth + 1);
            return;
          }
          const len = parseInt(
            (res.headers["content-length"] as string | undefined) || "0",
            10
          );
          res.resume();
          resolve({ statusCode: code, contentLength: len, finalUrl: u });
        }
      );
      req.on("error", () => {
        resolve({ statusCode: 0, contentLength: 0, finalUrl: u });
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve({ statusCode: 0, contentLength: 0, finalUrl: u });
      });
      req.end();
    };
    start(url, 0);
  });
}

interface StreamProgress {
  percent: number;
  downloaded: number;
  total: number;
}

/**
 * Simple HTTPS/HTTP streaming downloader with redirect following and a hard
 * timeout. Resolves with the total number of bytes written; rejects on any
 * non-2xx status, network error, or timeout.
 */
function streamToFile(
  url: string,
  dest: string,
  timeoutMs: number,
  userAgent: string,
  onProgress?: (p: StreamProgress) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const MAX_REDIRECTS = 5;

    const start = (currentUrl: string, redirectsLeft: number): void => {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        reject(new Error(`invalid url: ${currentUrl}`));
        return;
      }
      const client = parsed.protocol === "http:" ? http : https;
      const req = client.get(
        currentUrl,
        {
          timeout: timeoutMs,
          headers: { "User-Agent": userAgent, Accept: "*/*" },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
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

          const total = parseInt(
            (res.headers["content-length"] as string | undefined) || "0",
            10
          );
          let downloaded = 0;

          const out = fs.createWriteStream(dest);
          res.on("data", (chunk: Buffer) => {
            downloaded += chunk.length;
            if (onProgress && total > 0) {
              onProgress({
                percent: Math.round((downloaded / total) * 100),
                downloaded,
                total,
              });
            }
          });
          res.pipe(out);
          out.on("finish", () => out.close(() => resolve(downloaded)));
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

interface RawHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

/** Minimal in-memory GET — used by httpGetJsonFromPool. */
function rawHttpGet(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const MAX_REDIRECTS = 5;
    const start = (currentUrl: string, depth: number): void => {
      if (depth > MAX_REDIRECTS) {
        reject(new Error(`too many redirects at ${currentUrl}`));
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        reject(new Error(`invalid url: ${currentUrl}`));
        return;
      }
      const client = parsed.protocol === "http:" ? http : https;
      const req = client.get(currentUrl, { headers, timeout: timeoutMs }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, currentUrl).toString();
          start(next, depth + 1);
          return;
        }
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () =>
          resolve({
            statusCode: status,
            body,
            headers: res.headers as Record<string, string>,
          })
        );
        res.on("error", reject);
      });
      req.on("timeout", () => {
        req.destroy(new Error(`timeout after ${timeoutMs}ms`));
      });
      req.on("error", reject);
    };
    start(url, 0);
  });
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
