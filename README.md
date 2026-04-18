# WeGame Launcher

一款运行在 SteamOS / Steam Deck 上的独立桌面应用，用于在 Linux 环境下配置和启动腾讯 WeGame 游戏平台。

> 当前版本：**v1.7.1**（2026-04-18）· 详见 [PRD.md](./PRD.md) 与 [DEVLOG.md](./DEVLOG.md)

## 功能特性

- **5 步安装向导** - 引导用户完成从"中间层检测"到"WeGame 本体安装"的全流程
  1. 确认中间层（Wine / winetricks / Proton 的扫描与选择）
  2. 确认依赖（按需勾选：默认全部按需，Proton-GE 已自带 CJK 渲染与 vcrun，避免无意义重装）
  3. 路径选择（Wine Prefix / 下载缓存等路径）
  4. 执行安装（前置 `wineboot --init` 兜底；**0 依赖时自动跳过 winetricks 阶段，直接仅创建 Wine 环境并进入下一步**）
  5. 安装 WeGame（自动下载腾讯官方安装器并在 Wine 里运行，完成后校验 `WeGameLauncher.exe`）
- **中间层管理** - 扫描 / 切换 / 删除 Proton；下载安装最新 GE-Proton；一键将 winetricks 安装到用户目录（免 sudo）
- **依赖管理** - 支持复扫、按需安装、失败重试、跳过与缓存清理，自动从国内镜像预拉取以规避境外源失败
- **诊断面板** - 一键跑完 Proton 版本 / 网络 / DNS / TLS / Wine 状态等检查，失败项给出可执行建议
- **启动器** - 一键启动 / 停止 WeGame；启动失败时给出红色错误横幅，若错误是「未安装 WeGame」会直接给出「打开配置向导」的直达按钮
- **游戏库管理** - 扫描 WeGame 已安装游戏，支持添加到 Steam 库
- **设置页** - 立即生效的配置编辑（防抖自动保存），支持自定义环境变量与启动参数
- **日志系统** - 按模块拆分（`launcher_*.log` / `dependencies_*.log` / `installer_*.log`），会话级轮转，支持一键清理

## 技术栈

- **前端**: React 18 + TypeScript + TailwindCSS + react-router-dom
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

1. 首次打开应用会自动弹出「环境设置」向导（5 步）
2. **步骤 1** 确认中间层：扫描并选择 Wine / winetricks / Proton（缺少 GE-Proton 时可一键下载）
3. **步骤 2** 确认依赖：默认**完全按需**，仅在 WeGame 日后报错时再回来勾选对应依赖
4. **步骤 3** 路径选择：自定义 Wine Prefix 与缓存路径（一般保持默认即可）
5. **步骤 4** 执行安装：点击「开始安装」后自动创建 prefix、执行 `wineboot --init`、安装所选依赖；**未勾选任何依赖也可直接进入下一步，按钮会自动切换为「创建环境并继续」**
6. **步骤 5** 安装 WeGame：点击「下载并安装 WeGame」，应用会自动下载腾讯官方安装器（`dldir1.qq.com/WeGame/Setup/WeGameSetup.exe`）并在 Wine 内运行图形化安装向导
7. 完成向导后进入「启动器」→「启动 WeGame」，同时可扫描 WeGame 已安装的游戏，挑选后添加到 Steam 库

如果启动失败，页面顶部会出现红色错误横幅，并给出 `~/.local/share/decky-wegame/logs/launcher.log` 日志路径；若错误是「未安装 WeGame」，可直接点击横幅里的「打开配置向导」按钮跳回第 5 步继续安装。

## 项目结构

```
decky-wegame/
├── .github/workflows/      # GitHub Actions 自动构建配置
├── electron/               # Electron 主进程 (Node.js/TypeScript)
│   ├── main.ts             # 应用入口
│   ├── preload.ts          # 预加载脚本 (contextBridge)
│   ├── ipc.ts              # IPC 命令处理器
│   └── backend/            # 后端逻辑模块
│       ├── config.ts           # 配置文件管理
│       ├── environment.ts      # Wine Prefix 操作
│       ├── proton.ts           # Proton 版本检测
│       ├── middleware.ts       # 中间层管理（下载/删除 Proton，安装 winetricks 到用户目录）
│       ├── dep-scanner.ts      # 系统依赖扫描与路径验证
│       ├── dependencies.ts     # winetricks 依赖安装 + wineboot 初始化兜底
│       ├── mirrors.ts          # winetricks 缓存预填（国内镜像）
│       ├── wegame_installer.ts # WeGame 安装器下载与运行（v1.7 新增）
│       ├── launcher.ts         # 进程启停管理
│       ├── steam.ts            # Steam 快捷方式生成
│       ├── diagnostics.ts      # 运行时诊断（Proton/网络/DNS/TLS/Wine）
│       ├── updater.ts          # 应用自更新
│       ├── logger.ts           # 多模块分区日志
│       └── types.ts            # 类型定义
├── src/                    # React 前端
│   ├── pages/              # 页面组件（Dashboard / Launcher / SetupWizard / SettingsPage / Dependencies / About）
│   ├── components/         # 可复用 UI 组件
│   ├── hooks/              # 自定义 Hooks
│   └── utils/              # 常量、辅助函数和 API 桥接层
├── PRD.md                  # 产品需求文档（需求的唯一来源）
├── DEVLOG.md               # 开发日志（每次重要变更都在此追加）
└── package.json
```

## License

MIT
