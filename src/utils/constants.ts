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
  // ========================================================================
  // 推荐（默认勾选）：解决 WeGame 中文界面显示问题
  // ========================================================================
  {
    id: "font-microsoft-core",
    name: "Microsoft Core Fonts",
    category: "font",
    description: "Arial、Times New Roman 等基础英文字体（推荐）",
    size_mb: 8,
    required: true,
  },
  {
    id: "font-cjk",
    name: "CJK Support Fonts (CJKfonts)",
    category: "font",
    description: "中日韩字体，解决 WeGame 界面中文方块问题（强烈推荐）",
    size_mb: 25,
    required: true,
  },

  // ========================================================================
  // 按需（默认不勾选）：Proton-GE 已内置，或仅在特定报错时补装
  //   策略说明（PRD §4.1 步骤2）：WeGame 主体是 C++/Qt，不依赖 .NET；
  //   Proton-GE 已内置 vcrun/d3dx9 等常用依赖，重复安装无意义且易失败。
  //   按需依赖仅当 WeGame 运行时报具体错误时，再由用户手动勾选安装。
  // ========================================================================

  // .NET Framework（Wine 下不稳定，按需安装）
  {
    id: "dotnet46",
    name: ".NET Framework 4.6",
    category: "dotnet",
    description: "⚠️ Wine 下不稳定，仅在 WeGame 提示缺 .NET 时勾选",
    size_mb: 180,
    required: false,
  },
  {
    id: "dotnet48",
    name: ".NET Framework 4.8",
    category: "dotnet",
    description: "⚠️ Wine 下不稳定，仅在 WeGame 提示缺 .NET 时勾选",
    size_mb: 200,
    required: false,
  },

  // Visual C++ Redistributable（Proton-GE 已自带，通常无需安装）
  {
    id: "vcpp2005",
    name: "Visual C++ 2005 Redistributable",
    category: "vcpp",
    description: "Proton-GE 已自带；仅在旧组件报错时补装",
    size_mb: 6,
    required: false,
  },
  {
    id: "vcpp2008",
    name: "Visual C++ 2008 Redistributable",
    category: "vcpp",
    description: "Proton-GE 已自带；仅在组件报错时补装",
    size_mb: 9,
    required: false,
  },
  {
    id: "vcpp2010",
    name: "Visual C++ 2010 Redistributable",
    category: "vcpp",
    description: "Proton-GE 已自带；仅在组件报错时补装",
    size_mb: 11,
    required: false,
  },
  {
    id: "vcpp2012",
    name: "Visual C++ 2012 Redistributable",
    category: "vcpp",
    description: "Proton-GE 已自带；仅在组件报错时补装",
    size_mb: 12,
    required: false,
  },
  {
    id: "vcpp2013",
    name: "Visual C++ 2013 Redistributable",
    category: "vcpp",
    description: "Proton-GE 已自带；仅在组件报错时补装",
    size_mb: 13,
    required: false,
  },
  {
    id: "vcpp2015-2022",
    name: "Visual C++ 2015-2022 (x64)",
    category: "vcpp",
    description: "Proton-GE 已自带；仅在组件报错时补装",
    size_mb: 35,
    required: false,
  },

  // Browser / Web 组件（按需）
  {
    id: "ie8",
    name: "Internet Explorer 8",
    category: "browser",
    description: "仅在 WeGame 内嵌浏览器页面异常时安装",
    size_mb: 150,
    required: false,
  },

  // System 组件（按需）
  {
    id: "gdiplus",
    name: "GDI+ (gdiplus)",
    category: "system",
    description: "Windows 图形库，仅在界面绘制异常时补装",
    size_mb: 3,
    required: false,
  },
  {
    id: "mscoree",
    name: ".NET Core Runtime (mscoree)",
    category: "system",
    description: "仅在 .NET 相关报错时补装",
    size_mb: 2,
    required: false,
  },
  {
    id: "directx9",
    name: "DirectX 9.0c (d3dx9)",
    category: "system",
    description: "Proton-GE 已自带；仅在旧游戏报缺 d3dx9 时补装",
    size_mb: 50,
    required: false,
  },

  // Other（按需）
  {
    id: "vcrun6",
    name: "Visual Basic 6 Runtime (vcrun6)",
    category: "other",
    description: "VB6 兼容层，仅在 WeGame 内置组件报错时补装",
    size_mb: 5,
    required: false,
  },
];

export const FAQ_ITEMS = [
  {
    question: "WeGame 安装或启动卡在 0% 怎么办？",
    answer:
      "这类问题通常与「依赖缺失」无关，而是 WeGame 自带下载器（TenioDL）在 Wine 下无法访问腾讯 CDN。请先打开「依赖管理 → WeGame 运行诊断」查看网络连通性、DNS、TLS 证书等检测结果。常见解决方式：切换 DNS 为 119.29.29.29（DNSPod）、更新系统 ca-certificates、或升级到 GE-Proton 8.x 以上版本。",
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
