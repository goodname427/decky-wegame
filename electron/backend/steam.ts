import fs from "fs";
import path from "path";
import { expandPath } from "./environment";
import { EnvironmentConfig, GameEntry } from "./types";

const DESKTOP_ENTRY_DIR = "~/.local/share/applications";

export function generateDesktopEntry(
  game: GameEntry,
  config: EnvironmentConfig
): string {
  const desktopDir = expandPath(DESKTOP_ENTRY_DIR);
  fs.mkdirSync(desktopDir, { recursive: true });

  const safeName = game.name.replace(/[^a-zA-Z0-9 \-]/g, "_");
  const filename = `decky-wegame-${safeName.toLowerCase()}.desktop`;
  const filePath = path.join(desktopDir, filename);

  const content = `[Desktop Entry]
Name=${game.name}
Comment=Launched via WeGame Launcher
Exec=sh -c "WINEPREFIX='${config.wine_prefix_path}' '${game.exe_path}'"
Icon=steam_icon
Terminal=false
Type=Application
Categories=Game;
StartupWMClass=winegame.exe
Path=${game.working_dir}
`;

  fs.writeFileSync(filePath, content, "utf-8");
  fs.chmodSync(filePath, 0o755);

  return filePath;
}

export function addToSteam(
  game: GameEntry,
  desktopPath: string
): string {
  return `Steam Shortcut Added!

Game: ${game.name}
Desktop File: ${desktopPath}

Next Steps:
1. Open Steam
2. Go to Library → + Add Game → Add a Non-Steam Game
3. Browse and select the desktop file:
   ${desktopPath}
4. Right-click the game in Steam → Properties → Compatibility
5. Check 'Force using Steam Play compatibility tool'
6. Select your Proton version
7. Click Play to launch!`;
}

export function listWegameGames(config: EnvironmentConfig): GameEntry[] {
  const games: GameEntry[] = [];
  const prefixPath = expandPath(config.wine_prefix_path);
  const wegameDir = path.join(prefixPath, "drive_c/Program Files/Tencent");

  if (!fs.existsSync(wegameDir)) return games;

  const scanPaths = [
    path.join(wegameDir, "WeGame"),
    path.join(wegameDir, "QQGame"),
    path.join(prefixPath, "drive_c/Program Files (x86)/Tencent"),
  ];

  for (const scanPath of scanPaths) {
    if (!fs.existsSync(scanPath)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(scanPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const dirPath = path.join(scanPath, name);
      findExeInDir(dirPath, name, games);
    }
  }

  games.sort((a, b) => a.name.localeCompare(b.name));

  // Dedup by exe_path
  const seen = new Set<string>();
  return games.filter((g) => {
    if (seen.has(g.exe_path)) return false;
    seen.add(g.exe_path);
    return true;
  });
}

function findExeInDir(
  dir: string,
  parentName: string,
  games: GameEntry[]
): void {
  const specificExes = [
    "Game.exe",
    "Launcher.exe",
    "Start.exe",
    "Client.exe",
  ];

  // First try specific exe names
  for (const exeName of specificExes) {
    const fullPath = path.join(dir, exeName);
    if (fs.existsSync(fullPath)) {
      games.push({
        name: parentName,
        exe_path: fullPath,
        working_dir: dir,
        added_to_steam: false,
      });
      return;
    }
  }

  // Glob search for any .exe
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fileName = entry.name;
    if (
      fileName.endsWith(".exe") &&
      !fileName.toLowerCase().includes("uninstall") &&
      !fileName.toLowerCase().includes("setup")
    ) {
      games.push({
        name: fileName.replace(".exe", ""),
        exe_path: path.join(dir, fileName),
        working_dir: dir,
        added_to_steam: false,
      });
    }
  }
}
