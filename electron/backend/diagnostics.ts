/**
 * WeGame runtime diagnostics (PRD v1.4 §4.7).
 *
 * Goal: when a user reports "WeGame starts but installer sticks at 0%", give
 * them a structured, one-click report that identifies WHICH subsystem is
 * broken instead of telling them to "go install more dotnet". The checks
 * focus on network / DNS / TLS / Wine process state — NOT dependency
 * presence — because real-world logs show these are the actual root causes.
 *
 * Every check must:
 *   - Have a short timeout (never block > 5s)
 *   - Return a structured result even on failure (never throw out)
 *   - Be independent (one failing check does not skip others)
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import dns from "dns";
import { promisify } from "util";
import { EnvironmentConfig } from "./types";
import { expandPath } from "./environment";
import { depsLogger as log } from "./logger";

const dnsResolve4 = promisify(dns.resolve4);

export type DiagnosticStatus = "pass" | "warn" | "fail" | "skip";

export interface DiagnosticResult {
  id: string;
  title: string;
  status: DiagnosticStatus;
  message: string;
  /** Optional structured detail for UI expanders (stdout, hint, next steps) */
  detail?: string;
  /** Suggested action for the user, shown as a button hint */
  suggestion?: string;
  /** ms this check spent, for the log */
  elapsedMs: number;
}

export interface DiagnosticReport {
  timestamp: string;
  results: DiagnosticResult[];
  /** overall = worst individual status, ignoring "skip" */
  overall: DiagnosticStatus;
}

// Tencent CDN hosts WeGame / TenioDL usually talks to. This list is
// intentionally conservative; add more when we observe more in real logs.
const TENCENT_HOSTS = [
  "dldir1.qq.com",
  "dl.qq.com",
  "cdn-go.cn",
];

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkDns(): Promise<DiagnosticResult> {
  const started = Date.now();
  const failed: string[] = [];
  const details: string[] = [];
  for (const host of TENCENT_HOSTS) {
    try {
      const addrs = await dnsResolve4(host);
      details.push(`${host} -> ${addrs.join(", ")}`);
    } catch (err) {
      failed.push(host);
      details.push(`${host} -> ERROR (${(err as Error).message})`);
    }
  }
  const elapsedMs = Date.now() - started;
  if (failed.length === 0) {
    return {
      id: "dns",
      title: "DNS 解析（腾讯 CDN）",
      status: "pass",
      message: "全部域名解析正常",
      detail: details.join("\n"),
      elapsedMs,
    };
  }
  return {
    id: "dns",
    title: "DNS 解析（腾讯 CDN）",
    status: failed.length === TENCENT_HOSTS.length ? "fail" : "warn",
    message: `以下域名无法解析：${failed.join(", ")}`,
    detail: details.join("\n"),
    suggestion: "建议将 DNS 切换为 119.29.29.29（DNSPod）或 223.5.5.5（AliDNS）",
    elapsedMs,
  };
}

function httpGetStatus(host: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // Use curl — it handles TLS + redirects + timeout robustly with a single
    // syscall and is guaranteed to exist on SteamOS.
    const child = spawn("curl", [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--max-time",
      String(Math.round(timeoutMs / 1000)),
      `https://${host}/`,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr.on("data", (b: Buffer) => (err += b.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(parseInt(out.trim(), 10) || 0);
      } else {
        reject(new Error(err.trim() || `curl exited with ${code}`));
      }
    });
    child.on("error", (e) => reject(e));
  });
}

async function checkHttpReachability(): Promise<DiagnosticResult> {
  const started = Date.now();
  const details: string[] = [];
  const failed: string[] = [];
  for (const host of TENCENT_HOSTS) {
    try {
      const status = await httpGetStatus(host, 5000);
      details.push(`${host} -> HTTP ${status}`);
      // Any response (even 403/404) means TCP + TLS worked.
      if (status === 0) failed.push(host);
    } catch (e) {
      failed.push(host);
      details.push(`${host} -> ${(e as Error).message}`);
    }
  }
  const elapsedMs = Date.now() - started;
  if (failed.length === 0) {
    return {
      id: "https",
      title: "HTTPS 连通性（腾讯 CDN）",
      status: "pass",
      message: "全部主机可达",
      detail: details.join("\n"),
      elapsedMs,
    };
  }
  return {
    id: "https",
    title: "HTTPS 连通性（腾讯 CDN）",
    status: failed.length === TENCENT_HOSTS.length ? "fail" : "warn",
    message: `以下主机 HTTPS 不通：${failed.join(", ")}`,
    detail: details.join("\n"),
    suggestion:
      "可能原因：1) 系统 CA 证书过期 → 尝试 `sudo update-ca-certificates`；2) 网络代理/防火墙拦截；3) ISP 路由问题",
    elapsedMs,
  };
}

async function checkCaCertificates(): Promise<DiagnosticResult> {
  const started = Date.now();
  const candidates = [
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/ssl/cert.pem",
    "/etc/pki/tls/certs/ca-bundle.crt",
  ];
  const found = candidates.filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).size > 0;
    } catch {
      return false;
    }
  });
  const elapsedMs = Date.now() - started;
  if (found.length > 0) {
    return {
      id: "ca",
      title: "系统 CA 证书包",
      status: "pass",
      message: `已找到：${found[0]}`,
      detail: found.join("\n"),
      elapsedMs,
    };
  }
  return {
    id: "ca",
    title: "系统 CA 证书包",
    status: "fail",
    message: "未找到可用的 CA 证书包",
    suggestion: "SteamOS 下执行：sudo steamos-readonly disable && sudo pacman -Sy ca-certificates",
    elapsedMs,
  };
}

async function checkTenioDlProcess(config?: EnvironmentConfig): Promise<DiagnosticResult> {
  const started = Date.now();
  try {
    const out = execSync("pgrep -af TenioDL || true", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    const elapsedMs = Date.now() - started;
    if (out) {
      return {
        id: "teniodl",
        title: "WeGame 下载器（TenioDL）进程",
        status: "pass",
        message: "检测到 TenioDL 进程正在运行",
        detail: out,
        elapsedMs,
      };
    }
    // No process found — this is not necessarily an error (WeGame might not be
    // running). We return "warn" if WeGame process is running but TenioDL is
    // not — otherwise "skip".
    const wegameRunning = (() => {
      try {
        return execSync("pgrep -af 'wegame.exe|WeGame' || true", {
          encoding: "utf-8",
          timeout: 3000,
        }).trim().length > 0;
      } catch {
        return false;
      }
    })();
    if (wegameRunning) {
      return {
        id: "teniodl",
        title: "WeGame 下载器（TenioDL）进程",
        status: "warn",
        message: "WeGame 正在运行但未检测到 TenioDL 进程",
        suggestion: "尝试在 WeGame 内重新开始安装流程，观察是否有 TenioDL.exe 出现",
        elapsedMs,
      };
    }
    return {
      id: "teniodl",
      title: "WeGame 下载器（TenioDL）进程",
      status: "skip",
      message: "WeGame 当前未运行，跳过",
      elapsedMs,
    };
  } catch (e) {
    return {
      id: "teniodl",
      title: "WeGame 下载器（TenioDL）进程",
      status: "warn",
      message: `进程查询失败：${(e as Error).message}`,
      elapsedMs: Date.now() - started,
    };
  }
}

async function checkWegameLog(config?: EnvironmentConfig): Promise<DiagnosticResult> {
  const started = Date.now();
  if (!config?.wine_prefix_path) {
    return {
      id: "wegame-log",
      title: "WeGame 日志目录",
      status: "skip",
      message: "未配置 Wine prefix，跳过",
      elapsedMs: Date.now() - started,
    };
  }
  const prefix = expandPath(config.wine_prefix_path);
  const candidates = [
    path.join(prefix, "drive_c", "users"),
  ];
  const hits: string[] = [];
  for (const base of candidates) {
    try {
      if (!fs.existsSync(base)) continue;
      for (const user of fs.readdirSync(base)) {
        const p = path.join(base, user, "AppData", "Roaming", "Tencent", "WeGame", "logs");
        if (fs.existsSync(p)) hits.push(p);
      }
    } catch {
      // ignore
    }
  }
  const elapsedMs = Date.now() - started;
  if (hits.length === 0) {
    return {
      id: "wegame-log",
      title: "WeGame 日志目录",
      status: "skip",
      message: "WeGame 尚未产生日志（可能首次启动未完成）",
      elapsedMs,
    };
  }
  return {
    id: "wegame-log",
    title: "WeGame 日志目录",
    status: "pass",
    message: `已找到 ${hits.length} 份日志目录`,
    detail: hits.join("\n"),
    suggestion: "如 WeGame 报错，请将日志目录下最新的 .log 文件附到反馈中",
    elapsedMs,
  };
}

async function checkProtonVersion(config?: EnvironmentConfig): Promise<DiagnosticResult> {
  const started = Date.now();
  const protonPath = config?.proton_path ? expandPath(config.proton_path) : undefined;
  if (!protonPath || !fs.existsSync(protonPath)) {
    return {
      id: "proton-version",
      title: "Proton 版本",
      status: "fail",
      message: "未选择或找不到 Proton",
      suggestion: "请在『依赖管理 → 中间层管理』选择一个 Proton-GE 版本（推荐 8.x 以上）",
      elapsedMs: Date.now() - started,
    };
  }
  const protonDir = path.dirname(protonPath);
  const versionFile = path.join(protonDir, "version");
  let version = "unknown";
  try {
    if (fs.existsSync(versionFile)) {
      version = fs.readFileSync(versionFile, "utf-8").trim();
    } else {
      version = path.basename(protonDir);
    }
  } catch {
    // ignore
  }
  const elapsedMs = Date.now() - started;
  // Heuristic: GE-Proton7 / Proton 7.x is known-old and often causes issues
  // with WeGame (Proton-GE 8.x / 9.x are the community-recommended baseline).
  const isOld = /(?:^|[^0-9])7\b/.test(version) || /wine-7\./.test(version);
  if (isOld) {
    return {
      id: "proton-version",
      title: "Proton 版本",
      status: "warn",
      message: `当前 Proton 版本偏旧：${version}`,
      suggestion: "建议升级到 GE-Proton 8.x 或 9.x 以获得更好的 WeGame 兼容性",
      elapsedMs,
    };
  }
  return {
    id: "proton-version",
    title: "Proton 版本",
    status: "pass",
    message: version,
    elapsedMs,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runDiagnostics(
  config?: EnvironmentConfig
): Promise<DiagnosticReport> {
  log.separator();
  log.info("=== WeGame Diagnostics Start ===");

  const checks: Array<Promise<DiagnosticResult>> = [
    checkDns(),
    checkHttpReachability(),
    checkCaCertificates(),
    checkTenioDlProcess(config),
    checkWegameLog(config),
    checkProtonVersion(config),
  ];

  // Run in parallel — all checks are independent.
  const results = await Promise.all(checks);

  // Overall status = worst non-skip status
  const priority: Record<DiagnosticStatus, number> = { pass: 0, skip: 0, warn: 1, fail: 2 };
  let overall: DiagnosticStatus = "pass";
  for (const r of results) {
    if (priority[r.status] > priority[overall]) overall = r.status;
  }

  for (const r of results) {
    log.info(`[diag] ${r.status.toUpperCase()} ${r.id} — ${r.message} (${r.elapsedMs}ms)`);
  }
  log.info(`=== WeGame Diagnostics End: overall=${overall} ===`);

  return {
    timestamp: new Date().toISOString(),
    results,
    overall,
  };
}
