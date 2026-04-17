import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { registerIpcHandlers } from "./ipc";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    title: "WeGame Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Steam Deck friendly: dark background to avoid white flash
    backgroundColor: "#0A0E17",
    show: false,
  });

  // Show window when ready to avoid white flash
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Load the frontend
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Register all IPC handlers
registerIpcHandlers(ipcMain);

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Export mainWindow getter for event emitting
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
