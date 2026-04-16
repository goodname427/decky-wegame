import type { DependencyItem } from "../types";

export const APP_NAME = "WeGame Launcher";
export const APP_VERSION = "0.1.0";

export const DEFAULT_WINE_PREFIX_PATH =
  "~/.local/share/decky-wegame/prefix";
export const DEFAULT_CONFIG_DIR = "~/.local/share/decky-wegame/config";
export const DEFAULT_CACHE_DIR = "~/.local/share/decky-wegame/cache";

export const PROTON_SEARCH_PATHS = [
  "~/.steam/root/compatibilitytools.d/",
  "~/.local/share/Steam/compatibilitytools.d/",
  "/usr/share/steam/compatibilitytools.d/",
];

export const STEAM_APPS_DIR = "~/.steam/root/steamapps";
export const STEAM_SHORTCUTS_FILE = "~/.steam/root/steamapps/shortcuts.vdf";

export const WEGAME_DEFAULT_INSTALL_PATH =
  "~/.local/share/decky-wegame/prefix/drive_c/Program Files/Tencent/WeGame";

export const DEPENDENCY_LIST: Omit<DependencyItem, "installed" | "install_time">[] = [
  // .NET Framework
  {
    id: "dotnet46",
    name: ".NET Framework 4.6",
    category: "dotnet",
    description: "WeGame 核心运行时依赖",
    size_mb: 180,
    required: true,
  },
  {
    id: "dotnet48",
    name: ".NET Framework 4.8",
    category: "dotnet",
    description: "最新版 .NET Framework 运行时（推荐）",
    size_mb: 200,
    required: true,
  },
  // Visual C++ Redistributable
  {
    id: "vcpp2005",
    name: "Visual C++ 2005 Redistributable",
    category: "vcpp",
    description: "部分旧组件依赖的 VC++ 运行时",
    size_mb: 6,
    required: false,
  },
  {
    id: "vcpp2008",
    name: "Visual C++ 2008 Redistributable",
    category: "vcpp",
    description: "部分游戏组件依赖",
    size_mb: 9,
    required: true,
  },
  {
    id: "vcpp2010",
    name: "Visual C++ 2010 Redistributable",
    category: "vcpp",
    description: "广泛使用的 VC++ 运行时版本",
    size_mb: 11,
    required: true,
  },
  {
    id: "vcpp2012",
    name: "Visual C++ 2012 Redistributable",
    category: "vcpp",
    description: "部分游戏和工具依赖",
    size_mb: 12,
    required: true,
  },
  {
    id: "vcpp2013",
    name: "Visual C++ 2013 Redistributable",
    category: "vcpp",
    description: "常用 VC++ 运行时",
    size_mb: 13,
    required: true,
  },
  {
    id: "vcpp2015-2022",
    name: "Visual C++ 2015-2022 (x64)",
    category: "vcpp",
    description: "最新版 VC++ 运行时集合包",
    size_mb: 35,
    required: true,
  },
  // Fonts
  {
    id: "font-microsoft-core",
    name: "Microsoft Core Fonts",
    category: "font",
    description: "Arial、Times New Roman 等基础字体",
    size_mb: 8,
    required: true,
  },
  {
    id: "font-cjk",
    name: "CJK Support Fonts (CJKfonts)",
    category: "font",
    description: "中日韩文字支持字体，解决中文乱码问题",
    size_mb: 25,
    required: true,
  },
  // Browser / Web components
  {
    id: "ie8",
    name: "Internet Explorer 8",
    category: "browser",
    description: "WeGame 内嵌浏览器依赖的 IE 内核组件",
    size_mb: 150,
    required: true,
  },
  // System components
  {
    id: "gdiplus",
    name: "GDI+ (gdiplus)",
    category: "system",
    description: "Windows 图形设备接口库",
    size_mb: 3,
    required: true,
  },
  {
    id: "mscoree",
    name: ".NET Core Runtime (mscoree)",
    category: "system",
    description: ".NET Framework 核心执行引擎",
    size_mb: 2,
    required: true,
  },
  {
    id: "directx9",
    name: "DirectX 9.0c (d3dx9)",
    category: "system",
    description: "DirectX 9 运行时库，部分游戏需要",
    size_mb: 50,
    required: true,
  },
  {
    id: "vcrun6",
    name: "Visual Basic 6 Runtime (vcrun6)",
    category: "other",
    description: "VB6 运行时兼容层",
    size_mb: 5,
    required: false,
  },
];

export const FAQ_ITEMS = [
  {
    question: "WeGame 安装或启动卡在 0% 怎么办？",
    answer:
      "这通常是因为依赖未安装完整。请在「依赖管理」页面检查并安装所有必需组件，特别是 .NET Framework 和 IE 内核组件。如果仍然卡住，尝试在设置中重置 Wine Prefix 后重新初始化环境。",
  },
  {
    question: "哪些游戏可以在 Steam Deck 上正常运行？",
    answer:
      "大部分基于 DX9/DX11 的游戏通过 GE-Proton 可以较好运行。DX12 游戏兼容性也在不断提升。建议优先测试 2D 游戏和较早期的 3D 游戏，大型 3A 新作可能需要额外配置。",
  },
  {
    question: "如何更换 Proton 版本？",
    answer:
      "在「设置」页面可以修改 Proton 路径。推荐使用 GE-Proton 最新版本以获得最佳兼容性。你可以从 GloriousEggroll 的 GitHub 发布页下载后放入 ~/.steam/root/compatibilitytools.d/ 目录。",
  },
  {
    question: "如何手动修复损坏的 Wine 环境？",
    answer:
      "进入「设置」→「危险操作区」→「重置 Wine Prefix」。注意这会清除所有已安装的 Windows 程序和配置，但不会删除 WeGame 安装包。重置后需要重新安装依赖。",
  },
  {
    question: "日志文件保存在哪里？",
    answer:
      "运行日志实时显示在应用内的日志面板中，同时也会保存到 ~/.local/share/decky-wegame/logs/ 目录下。如需提交 Bug 反馈，请附上最新的日志文件。",
  },
  {
    question: "添加到 Steam 后游戏无法启动怎么办？",
    answer:
      "确保在 Steam 中为该非 Steam 游戏选择了正确的 Proton 兼容性选项（右键 → 属性 → 兼容性 → 勾选「强制使用 Steam Play 兼容工具」）。Wine Prefix 路径应与 WeGame Launcher 中设置的路径一致。",
  },
];
