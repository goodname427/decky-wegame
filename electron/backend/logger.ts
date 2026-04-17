import fs from "fs";
import path from "path";

const LOG_DIR_NAME = "decky-wegame/logs";
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per log file
const MAX_LOG_FILES = 3; // Keep up to 3 rotated files

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

let logDir: string | null = null;

function getLogDir(): string {
  if (logDir) return logDir;
  const dataDir =
    process.env.XDG_DATA_HOME ||
    path.join(process.env.HOME || "/home/deck", ".local/share");
  logDir = path.join(dataDir, LOG_DIR_NAME);
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}

function getLogFilePath(name: string): string {
  return path.join(getLogDir(), `${name}.log`);
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_LOG_SIZE) return;

    // Rotate: .log -> .log.1 -> .log.2 -> .log.3 (delete oldest)
    for (let i = MAX_LOG_FILES; i >= 1; i--) {
      const older = `${filePath}.${i}`;
      const newer = i === 1 ? filePath : `${filePath}.${i - 1}`;
      if (fs.existsSync(newer)) {
        if (i === MAX_LOG_FILES) {
          fs.unlinkSync(older).toString;
        }
        fs.renameSync(newer, older);
      }
    }
  } catch {
    // Ignore rotation errors
  }
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

function writeLog(logName: string, level: LogLevel, message: string): void {
  try {
    const filePath = getLogFilePath(logName);
    rotateIfNeeded(filePath);
    const line = `[${formatTimestamp()}] [${level}] ${message}\n`;
    fs.appendFileSync(filePath, line, "utf-8");
  } catch {
    // Silently fail - logging should never crash the app
  }
}

/**
 * Create a named logger instance that writes to a specific log file.
 * Log files are stored in ~/.local/share/decky-wegame/logs/<name>.log
 */
export function createLogger(name: string) {
  return {
    debug: (msg: string) => writeLog(name, "DEBUG", msg),
    info: (msg: string) => writeLog(name, "INFO", msg),
    warn: (msg: string) => writeLog(name, "WARN", msg),
    error: (msg: string) => writeLog(name, "ERROR", msg),

    /** Log a separator line for readability */
    separator: () => writeLog(name, "INFO", "─".repeat(60)),

    /** Get the path to this logger's log file */
    getLogPath: () => getLogFilePath(name),
  };
}

/** Main application logger */
export const appLogger = createLogger("app");

/** Launcher (Proton/WeGame) logger */
export const launcherLogger = createLogger("launcher");

/** Dependency installation logger */
export const depsLogger = createLogger("dependencies");
