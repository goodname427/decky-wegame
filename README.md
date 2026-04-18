# WeGame Launcher

一款运行在 SteamOS / Steam Deck 上的独立桌面应用，用于在 Linux 环境下一站式配置并启动腾讯 WeGame 游戏平台。

> 当前版本：**v1.13.0** · 需求定义见 [PRD.md](./PRD.md)，关键开发记录见 [DEVLOG.md](./DEVLOG.md)

## 功能特性

- **一键自动安装** - 首启弹出欢迎页，点下大号「🚀 一键自动安装」按钮后依次自动完成 Proton 选择 / Wine Prefix 创建 / 核心依赖预拉取 / WeGame 本体安装；任何一步失败会自动跑一次环境诊断并把结果并入错误卡片（显示 HTTPS 不通 / DNS 故障 / Proton 缺失等定位信息），WeGame 下载完但装不上时会直接给出「选择本地安装器文件」按钮无缝降级；全程不需要手动配置代理、找镜像或搜资源包
- **高级模式逃生舱** - 高级模式的合法入口有三处：欢迎页右下角「高级模式 →」小按钮（首启可见）、自动配置进度页右上角「切换到高级模式 →」（运行中逃生，已完成状态会预填到向导里）、依赖管理页顶部「重新运行安装向导」（事后再调整，默认回到欢迎页让你选一键重跑或进入高级模式）
- **多镜像池内置** - 所有境外资源（Proton-GE、winetricks 依赖、WeGame 安装器、应用自更新等）统一走后端的 `downloadFromMirrorPool` 下载器，内置 GitHub 加速反代池（gh-proxy / ghproxy 等）+ WeGame 候选直链池 + 本地文件逃生舱 三层降级；任一镜像失效会自动切换到下一个，`[Mirror]` 专属日志类别可追溯命中哪个源
- **5 步安装向导（高级模式）** - 从「中间层检测」到「WeGame 本体安装」的全流程细粒度设置
  1. 确认中间层（Wine / winetricks / Proton 的扫描与选择）
  2. 确认依赖（默认全部按需勾选；Proton-GE 已内置大部分常用 Windows 依赖）
  3. 路径选择（Wine Prefix / WeGame 安装路径等）
  4. 执行安装（前置 `wineboot --init` 兜底；未勾选任何依赖时会跳过 winetricks，仅创建 Wine 环境）
  5. 安装 WeGame（自动抓官网下载源 → 内置候选列表 → 本地文件逃生舱三层兜底；仍保留「打开官网」的人工验证入口）
- **配置一致性** - 「安装向导」与「依赖管理页」共享同一套配置组件，能力对等、行为一致，不会出现「向导能做、管理页做不了」或反之的情况
- **中间层管理** - 扫描 / 切换 / 删除 Proton（自动识别 `compatibilitytools.d/` 下的 GE-Proton 与 `steamapps/common/Proton *` 下的 Valve 官方 Proton）；下载安装最新 GE-Proton；一键将 winetricks 安装到用户目录（免 sudo）
- **WeGame 本体管理** - 依赖管理页提供 WeGame 安装状态卡片，可直接「用本地文件重装」或「清缓存并在线重装」，无需重走向导
- **依赖管理** - 支持复扫、按需安装、**单项重装**（hover 即可触发）、失败重试、跳过与缓存清理，自动从国内镜像预拉取以规避境外源失败
- **诊断面板** - 一键跑完 Proton 版本 / 网络 / DNS / TLS / Wine 状态等检查，失败项给出可执行建议
- **启动器** - 一键启动 / 停止 WeGame；启动失败时给出红色错误横幅，若错误是「未安装 WeGame」会直接给出「打开配置向导」的直达按钮
- **游戏库管理** - 扫描 WeGame 已安装游戏，支持添加到 Steam 库
- **设置页** - 立即生效的配置编辑（防抖自动保存），支持自定义环境变量与启动参数
- **日志系统** - Unreal Engine 风格的会话级日志：每次运行一个文件 `decky-wegame_<时间戳>.log`，同时维护一份 `latest.log` 方便反馈问题；所有模块的输出按 `LogXxx` 类别前缀合并在同一个文件里，等级分为 `Error / Warning / Log / Verbose` 等，便于 `grep`。

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

### 首启（推荐）

首次打开应用会弹出**欢迎页**，只有两个主按钮：

- 屏幕中央大号「🚀 一键自动安装」：点击后进入「自动配置进度页」，依次自动完成
  1. 选择推荐 Proton（优先 Valve 官方 Proton，缺失时从镜像池下载 GE-Proton）
  2. 创建 / 修复 Wine Prefix（`wineboot --init` + 三文件健康检查）
  3. 预拉取核心依赖到 winetricks 缓存
  4. 引导安装 WeGame 本体（3 层兜底：官网动态解析 → 内置候选列表 → 本地文件选择器）
- 右下角小号「高级模式 →」：跳过自动流程，直接进入完整的 5 步向导（见下方「高级模式」）

自动流程完成后点「启动 WeGame」即可使用；如需微调，进入「设置 → 依赖管理」页。

### 高级模式（逃生舱）

自动配置页底部或依赖管理页顶部的「重新配置环境」按钮可进入完整的 5 步向导：

1. **步骤 1** 确认中间层：扫描并选择 Wine / winetricks / Proton；缺 GE-Proton 可在向导内直接「下载最新 GE-Proton」，缺 winetricks 可直接「立即下载到 `~/.local/bin`（无需密码）」
2. **步骤 2** 确认依赖：默认**完全按需**，仅在 WeGame 日后报错时再回来勾选对应依赖
3. **步骤 3** 路径选择：自定义 Wine Prefix 与 WeGame 安装路径（一般保持默认即可；修改 Wine 前缀会弹确认框提示不自动迁移）
4. **步骤 4** 执行安装：点击「开始安装」后自动创建 prefix、执行 `wineboot --init`、安装所选依赖；未勾选任何依赖也可直接进入下一步，按钮会切换为「创建环境并继续」
5. **步骤 5** 安装 WeGame：主推「在线下载并安装」（自动抓官网 / 走内置候选源）；若在线源全失败可点「选择本地安装器文件」或「打开官网」验证
6. 完成向导后进入「启动器」→「启动 WeGame」，同时可扫描 WeGame 已安装的游戏，挑选后添加到 Steam 库

向导完成后如需重新调整任何配置，**不必重走向导**：在「依赖管理」页顶部即可直接修改 Wine Prefix / WeGame 安装路径、切换 Proton、重装 winetricks、甚至「清缓存并重新安装 WeGame」，所有动作与向导一一对应。

如果启动失败，页面顶部会出现红色错误横幅，并给出 `~/.local/share/decky-wegame/logs/latest.log` 日志路径；若错误是「未安装 WeGame」，可直接点击横幅里的「打开配置向导」按钮跳回第 5 步继续安装。

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
│       ├── wegame_installer.ts # WeGame 安装器下载与运行
│       ├── launcher.ts         # 进程启停管理
│       ├── steam.ts            # Steam 快捷方式生成
│       ├── diagnostics.ts      # 运行时诊断（Proton/网络/DNS/TLS/Wine）
│       ├── updater.ts          # 应用自更新
│       ├── logger.ts           # UE 风格会话级日志（Category + Verbosity）
│       └── types.ts            # 类型定义
├── src/                    # React 前端
│   ├── pages/              # 页面组件（Dashboard / Launcher / SetupWizard / SettingsPage / Dependencies / About）
│   ├── components/         # 可复用 UI 组件
│   ├── hooks/              # 自定义 Hooks
│   └── utils/              # 常量、辅助函数和 API 桥接层
├── PRD.md                  # 产品需求文档（开发者视角，需求的唯一来源）
├── DEVLOG.md               # 开发日志（关键改动长期存档）
└── package.json
```

## License

MIT
