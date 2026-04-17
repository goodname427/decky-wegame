import fs from "fs";
import path from "path";

const LOG_DIR_NAME = "decky-wegame/logs";
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per log file
const MAX_LOG_FILES = 10; // Keep up to 10 rotated files
const MAX_SESSION_LOGS = 20; // Keep up to 20 session log files

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

/**
 * Generate a unique session ID for this run
 */
function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Get session-specific log file path
 */
function getSessionLogFilePath(name: string, sessionId?: string): string {
  const session = sessionId || generateSessionId();
  return path.join(getLogDir(), `${name}_${session}.log`);
}

/**
 * Get latest session log file path
 */
function getLatestSessionLogFilePath(name: string): string {
  return path.join(getLogDir(), `${name}.log`);
}

/**
 * Clean up old session logs to avoid disk space issues
 */
function cleanupOldSessionLogs(name: string): void {
  try {
    const logDir = getLogDir();
    const files = fs.readdirSync(logDir).filter(f => f.startsWith(`${name}_`) && f.endsWith('.log'));
    
    if (files.length > MAX_SESSION_LOGS) {
      // Sort by creation time (newest first)
      const sortedFiles = files.map(f => ({
        name: f,
        path: path.join(logDir, f),
        time: fs.statSync(path.join(logDir, f)).birthtime.getTime()
      })).sort((a, b) => b.time - a.time);
      
      // Remove oldest files beyond the limit
      const filesToRemove = sortedFiles.slice(MAX_SESSION_LOGS);
      filesToRemove.forEach(file => {
        try {
          fs.unlinkSync(file.path);
          console.log(`Cleaned up old log file: ${file.name}`);
        } catch (err) {
          console.warn(`Failed to cleanup log file ${file.name}: ${err}`);
        }
      });
    }
  } catch (err) {
    console.warn(`Failed to cleanup session logs: ${err}`);
  }
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
          fs.unlinkSync(older);
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

function writeLog(logName: string, level: LogLevel, message: string, sessionId?: string): void {
  try {
    const filePath = getSessionLogFilePath(logName, sessionId);
    const latestPath = getLatestSessionLogFilePath(logName);
    
    rotateIfNeeded(filePath);
    const line = `[${formatTimestamp()}] [${level}] ${message}\n`;
    fs.appendFileSync(filePath, line, "utf-8");
    
    // Also write to latest file for backward compatibility
    fs.appendFileSync(latestPath, line, "utf-8");
  } catch {
    // Silently fail - logging should never crash the app
  }
}

/**
 * Create a named logger instance that writes to a specific log file.
 * Each session gets its own log file with timestamp.
 */
export function createLogger(name: string) {
  const sessionId = generateSessionId();
  
  // Cleanup old logs on startup
  cleanupOldSessionLogs(name);
  
  return {
    debug: (msg: string) => writeLog(name, "DEBUG", msg, sessionId),
    info: (msg: string) => writeLog(name, "INFO", msg, sessionId),
    warn: (msg: string) => writeLog(name, "WARN", msg, sessionId),
    error: (msg: string) => writeLog(name, "ERROR", msg, sessionId),

    /** Log a separator line for readability */
    separator: () => writeLog(name, "INFO", "─".repeat(60), sessionId),

    /** Get the path to this logger's log file */
    getLogPath: () => getSessionLogFilePath(name, sessionId),
    
    /** Get the path to the latest log file */
    getLatestLogPath: () => getLatestSessionLogFilePath(name),
    
    /** Get the session ID for this logger */
    getSessionId: () => sessionId,
  };
}

/**
 * Clean up all log files
 */
export function cleanupAllLogs(): void {
  try {
    const logDir = getLogDir();
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
    
    files.forEach(file => {
      try {
        fs.unlinkSync(path.join(logDir, file));
        console.log(`Cleaned up log file: ${file}`);
      } catch (err) {
        console.warn(`Failed to cleanup log file ${file}: ${err}`);
      }
    });
    
    console.log(`Cleaned up ${files.length} log files`);
  } catch (err) {
    console.error(`Failed to cleanup logs: ${err}`);
  }
}

/** Main application logger */
export const appLogger = createLogger("app");

/** Launcher (Proton/WeGame) logger */
export const launcherLogger = createLogger("launcher");

/** Dependency installation logger */
export const depsLogger = createLogger("dependencies");
