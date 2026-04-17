# WeGame Launcher

一款运行在 SteamOS / Steam Deck 上的独立桌面应用，用于在 Linux 环境下配置和启动腾讯 WeGame 游戏平台。

## 功能特性

- **环境初始化** - 一键创建独立的 Wine/Proton 兼容前缀
- **Proton 管理** - 自动检测 GE-Proton 版本，支持手动选择
- **依赖安装** - 通过 winetricks 自动安装 .NET Framework、VC++ 运行时、中文字体等组件
- **WeGame 启停** - 配置完整环境变量，一键启动/停止 WeGame
- **游戏库管理** - 扫描已安装游戏，支持添加到 Steam 库
- **高级设置** - 自定义路径、环境变量、启动参数

## 技术栈

- **前端**: React 18 + TypeScript + TailwindCSS
- **后端**: Electron + Node.js (TypeScript)
- **构建工具**: Vite 5 + electron-builder

---

## 安装方式

### 方式一：下载预编译版（推荐，最简单）

> Steam Deck 上**不需要安装任何编译工具**，直接运行即可。

1. 进入本仓库的 **Actions** 页面
2. 点击最新的成功构建（绿色 ✓）
3. 在页面底部的 **Artifacts** 区域下载 `WeGame-Launcher-x86_64.zip`
4. 将 `.AppImage` 文件传输到 Steam Deck

**传输方式（任选其一）：**

| 方式 | 操作 |
|------|------|
| U 盘 | 复制到 U 盘 → Steam Deck 桌面模式挂载 |
| SCP | `scp WeGame_Launcher.AppImage deck@<IP>:~/Desktop/` |
| 网盘 | 上传后用 Steam Deck 浏览器下载 |

**在 Steam Deck 上运行：**

```bash
# 进入桌面模式（长按电源键 → Switch to Desktop）
# 打开 Konsole 终端，执行：
chmod +x ~/Desktop/WeGame_Launcher-*.AppImage
~/Desktop/WeGame_Launcher-*.AppImage
```

**添加到 Steam 库（可选）：**

1. 打开 Steam → 左下角「添加游戏」→「添加非 Steam 游戏」
2. 浏览到 `.AppImage` 文件并添加
3. 之后可在游戏模式中直接启动

---

### 方式二：本地开发

```bash
# 需要先安装 Node.js
pnpm install
pnpm dev          # 启动 Vite 前端开发服务器
pnpm electron:dev # 启动 Electron 主进程（开发模式）
```

> Wine/Proton 相关功能仅在 Linux 上可用，其他平台仅可调试界面。

---

## 使用说明

1. 打开应用后进入「环境设置」向导
2. 选择 Proton 版本（推荐 GE-Proton）
3. 确认路径和要安装的依赖组件
4. 执行安装（可能需要 10-30 分钟）
5. 安装完成后点击「启动器」→「启动 WeGame」
6. 在「启动器」中扫描游戏并添加到 Steam 库

## 项目结构

```
DeckyWeGame/
├── .github/workflows/  # GitHub Actions 自动构建配置
├── electron/            # Electron 主进程 (Node.js/TypeScript)
│   ├── main.ts          # 应用入口
│   ├── preload.ts       # 预加载脚本 (contextBridge)
│   ├── ipc.ts           # IPC 命令处理器
│   └── backend/         # 后端逻辑模块
│       ├── config.ts        # 配置文件管理
│       ├── environment.ts   # Wine Prefix 操作
│       ├── proton.ts        # Proton 版本检测
│       ├── dependencies.ts  # winetricks 依赖安装
│       ├── launcher.ts      # 进程启停管理
│       ├── steam.ts         # Steam 快捷方式生成
│       └── types.ts         # 类型定义
├── src/                 # React 前端
│   ├── pages/           # 页面组件
│   ├── components/      # 可复用 UI 组件
│   ├── hooks/           # 自定义 Hooks
│   └── utils/           # 常量、辅助函数和 API 桥接层
└── package.json         # 依赖配置
```

## License

MIT
