import fs from "fs";
import path from "path";
import { format as utilFormat } from "util";

/**
 * Unreal Engine 风格的日志系统。
 *
 * 设计要点：
 *  - **每次运行一个日志文件**：启动时在 `logs/` 下创建
 *    `decky-wegame_<yyyyMMdd_HHmmss>.log`，当前会话的所有类别、所有等级都写进这一个文件。
 *  - **Category（类别）**：每个模块通过 `Log.category("WineBoot")` 取到
 *    一个带类别绑定的 logger，输出时前缀固定为 `LogWineBoot:`，便于 grep。
 *  - **Verbosity（等级）**：Fatal / Error / Warning / Display / Log / Verbose /
 *    VeryVerbose，与 UE 对齐。控制台阈值默认 `Log`（即 Log/Display/Warning/
 *    Error/Fatal 上屏）；文件阈值默认 `VeryVerbose`（即全部落盘）。
 *  - **latest.log**：会话文件同时复制一份到 `logs/latest.log`，方便用户
 *    「发最近一次日志」时不用找时间戳。
 *  - **行格式**（UE 经典格式）：
 *      [2026.04.18-18.25.32:161] LogWineBoot: Warning: prefix unhealthy ...
 *      [2026.04.18-18.25.44:635] LogDeps: detected installed packages: ...
 *    Verbosity 为 `Log` 时不写等级前缀；其余等级会写成
 *    `Error: / Warning: / Display: / Verbose: / VeryVerbose: / Fatal:`。
 */

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type Verbosity =
  | "Fatal"
  | "Error"
  | "Warning"
  | "Display"
  | "Log"
  | "Verbose"
  | "VeryVerbose";

const VERBOSITY_RANK: Record<Verbosity, number> = {
  Fatal: 0,
  Error: 1,
  Warning: 2,
  Display: 3,
  Log: 4,
  Verbose: 5,
  VeryVerbose: 6,
};

const LOG_DIR_NAME = "decky-wegame/logs";
const MAX_SESSION_LOGS = 20; // 只保留最近 20 次会话的日志文件

/** 控制台阈值：`Log` 及以上上屏（Verbose / VeryVerbose 只落盘）。 */
const CONSOLE_THRESHOLD: Verbosity = "Log";
/** 文件阈值：全部落盘。 */
const FILE_THRESHOLD: Verbosity = "VeryVerbose";

// ---------------------------------------------------------------------------
// Session bootstrap
// ---------------------------------------------------------------------------

function resolveLogDir(): string {
  const dataDir =
    process.env.XDG_DATA_HOME ||
    path.join(process.env.HOME || "/home/deck", ".local/share");
  const dir = path.join(dataDir, LOG_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function formatTimestampUE(): string {
  // [2026.04.18-18.25.32:161]
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}` +
    `-${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}` +
    `:${pad(now.getMilliseconds(), 3)}`
  );
}

const LOG_DIR = resolveLogDir();
const SESSION_ID = generateSessionId();
const SESSION_LOG_PATH = path.join(LOG_DIR, `decky-wegame_${SESSION_ID}.log`);
const LATEST_LOG_PATH = path.join(LOG_DIR, `latest.log`);

// 一次会话只用一个 append stream，避免每行都 open/close。
let sessionStream: fs.WriteStream | null = null;
let latestStream: fs.WriteStream | null = null;

function ensureStreams(): void {
  if (!sessionStream) {
    try {
      sessionStream = fs.createWriteStream(SESSION_LOG_PATH, { flags: "a" });
    } catch {
      sessionStream = null;
    }
  }
  if (!latestStream) {
    try {
      // latest.log 在每次会话启动时截断（truncate），只保留当次会话的内容。
      latestStream = fs.createWriteStream(LATEST_LOG_PATH, { flags: "w" });
    } catch {
      latestStream = null;
    }
  }
}

function cleanupOldSessionLogs(): void {
  try {
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f: string) => f.startsWith("decky-wegame_") && f.endsWith(".log"));
    if (files.length <= MAX_SESSION_LOGS) return;
    const sorted = files
      .map((f: string) => {
        const p = path.join(LOG_DIR, f);
        return { name: f, path: p, time: fs.statSync(p).mtime.getTime() };
      })
      .sort((a: { time: number }, b: { time: number }) => b.time - a.time);
    for (const old of sorted.slice(MAX_SESSION_LOGS)) {
      try {
        fs.unlinkSync(old.path);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Core writer
// ---------------------------------------------------------------------------

function formatArgs(args: unknown[]): string {
  // 支持两种调用风格：
  //   L.log("foo %s", x)   // printf 风格
  //   L.log("foo", x, y)   // 多参数拼接
  if (args.length === 0) return "";
  const [first, ...rest] = args;
  if (typeof first === "string" && rest.length > 0) {
    try {
      return utilFormat(first as string, ...rest);
    } catch {
      return [first, ...rest].map((a) => String(a)).join(" ");
    }
  }
  return args.map((a) => (typeof a === "string" ? a : utilFormat("%o", a))).join(" ");
}

function buildLine(category: string, verbosity: Verbosity, message: string): string {
  // UE 经典格式：Verbosity=Log 时省略等级前缀。
  const prefix = verbosity === "Log" ? "" : `${verbosity}: `;
  return `[${formatTimestampUE()}] Log${category}: ${prefix}${message}\n`;
}

function writeLine(category: string, verbosity: Verbosity, message: string): void {
  const rank = VERBOSITY_RANK[verbosity];

  // File output (all categories merge into one session file + latest.log)
  if (rank <= VERBOSITY_RANK[FILE_THRESHOLD]) {
    ensureStreams();
    const line = buildLine(category, verbosity, message);
    try {
      sessionStream?.write(line);
      latestStream?.write(line);
    } catch {
      // ignore
    }
  }

  // Console output
  if (rank <= VERBOSITY_RANK[CONSOLE_THRESHOLD]) {
    const line = buildLine(category, verbosity, message).replace(/\n$/, "");
    if (verbosity === "Error" || verbosity === "Fatal") {
      // eslint-disable-next-line no-console
      console.error(line);
    } else if (verbosity === "Warning") {
      // eslint-disable-next-line no-console
      console.warn(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API: Log.category("X")
// ---------------------------------------------------------------------------

export interface CategoryLogger {
  /** Verbosity = Log（默认信息级，无等级前缀） */
  log: (...args: unknown[]) => void;
  /** Verbosity = Display（高亮用户级信息） */
  display: (...args: unknown[]) => void;
  /** Verbosity = Warning */
  warn: (...args: unknown[]) => void;
  /** Verbosity = Error */
  error: (...args: unknown[]) => void;
  /** Verbosity = Fatal（极严重，通常伴随崩溃） */
  fatal: (...args: unknown[]) => void;
  /** Verbosity = Verbose（诊断细节，默认只落盘） */
  verbose: (...args: unknown[]) => void;
  /** Verbosity = VeryVerbose（原始 stdout/stderr 之类的噪声） */
  veryVerbose: (...args: unknown[]) => void;

  /** 兼容旧的 info 语义（= log） */
  info: (...args: unknown[]) => void;
  /** 兼容旧的 debug 语义（= verbose） */
  debug: (...args: unknown[]) => void;

  /** 便利：输出一行分隔符，便于日志分段阅读。 */
  separator: () => void;

  /** 当前会话日志文件路径 */
  getLogPath: () => string;
  /** latest.log 路径 */
  getLatestLogPath: () => string;
  /** 会话 ID */
  getSessionId: () => string;
}

function makeCategory(rawName: string): CategoryLogger {
  // 归一化类别名：去掉前缀 Log，如 "LogDeps" → "Deps"；空则为 Temp。
  const name = (rawName || "Temp").replace(/^Log/i, "");
  return {
    log: (...a) => writeLine(name, "Log", formatArgs(a)),
    display: (...a) => writeLine(name, "Display", formatArgs(a)),
    warn: (...a) => writeLine(name, "Warning", formatArgs(a)),
    error: (...a) => writeLine(name, "Error", formatArgs(a)),
    fatal: (...a) => writeLine(name, "Fatal", formatArgs(a)),
    verbose: (...a) => writeLine(name, "Verbose", formatArgs(a)),
    veryVerbose: (...a) => writeLine(name, "VeryVerbose", formatArgs(a)),
    info: (...a) => writeLine(name, "Log", formatArgs(a)),
    debug: (...a) => writeLine(name, "Verbose", formatArgs(a)),
    separator: () => writeLine(name, "Log", "─".repeat(60)),
    getLogPath: () => SESSION_LOG_PATH,
    getLatestLogPath: () => LATEST_LOG_PATH,
    getSessionId: () => SESSION_ID,
  };
}

/**
 * Unreal Engine 风格的日志门面。
 * 用法：`const L = Log.category("WineBoot"); L.warn("...");`
 */
export const Log = {
  category: makeCategory,
  /** 当前会话的主日志文件路径 */
  sessionLogPath: SESSION_LOG_PATH,
  /** latest.log 路径 */
  latestLogPath: LATEST_LOG_PATH,
  /** 会话 ID */
  sessionId: SESSION_ID,
};

// ---------------------------------------------------------------------------
// Backward-compatible legacy exports
// ---------------------------------------------------------------------------

/**
 * @deprecated 请使用 `Log.category("X")`；这里只是为了兼容旧 import。
 * 新实现下 `name` 参数直接作为 Category 使用。
 */
export function createLogger(name: string): CategoryLogger {
  return makeCategory(name);
}

/** 主程序 / IPC / 生命周期 */
export const appLogger = makeCategory("App");
/** 启动 WeGame / Proton 相关 */
export const launcherLogger = makeCategory("Launcher");
/** 依赖安装（winetricks、字体、运行时） */
export const depsLogger = makeCategory("Deps");
/** WeGame 下载与安装器 */
export const installerLogger = makeCategory("Installer");

/**
 * 清空历史日志（会话文件 + latest.log）。
 * 保留对外接口以兼容 ipc.ts 的调用。
 */
export function cleanupAllLogs(): void {
  try {
    sessionStream?.end();
    latestStream?.end();
    sessionStream = null;
    latestStream = null;
    const files = fs.readdirSync(LOG_DIR).filter((f: string) => f.endsWith(".log"));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(LOG_DIR, f));
      } catch {
        // ignore individual failures
      }
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Session init banner
// ---------------------------------------------------------------------------

cleanupOldSessionLogs();
ensureStreams();

// 在会话文件里写一段启动横幅，便于从日志中一眼识别新会话边界。
writeLine("Init", "Display", `==== decky-wegame session ${SESSION_ID} started ====`);
writeLine("Init", "Log", `pid=${process.pid} node=${process.version} platform=${process.platform}`);
writeLine("Init", "Log", `session log: ${SESSION_LOG_PATH}`);
