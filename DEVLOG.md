# 开发日志 (Development Log)

本文件记录 WeGame Launcher 项目的**重要架构变更、关键技术决策和核心功能实现**。

---

## 2026-04-16 — 项目初始化
- **目标**：在 SteamOS / Steam Deck 上运行腾讯 WeGame
- **技术栈**：React + TypeScript + TailwindCSS（前端），Tauri + Rust（后端）

## 2026-04-17 — 从 Tauri 迁移到 Electron
- **决策原因**：Tauri 的 WebKitGTK/EGL 兼容性问题无法在 Steam Deck 上解决
- **技术优势**：Electron 自带 Chromium，不依赖系统 WebView，彻底解决 EGL 问题
- **迁移效果**：前端代码零改动，后端逻辑从 Rust 改为 Node.js/TypeScript

## 2026-04-18 — 核心功能架构
- **UI 重构**：将 6 个页签精简为 4 个，优化用户体验
- **日志系统**：实现会话级日志管理，支持日志轮转和自动清理
- **依赖管理**：完整的依赖扫描、安装、跳过功能体系
- **环境检查**：自动检测 Wine/winetricks，提供安装指引
- **版本更新**：支持正式版和开发版双渠道更新检测

## 2026-04-18 — 技术优化
- **异步处理**：将同步命令执行改为异步，避免 UI 阻塞
- **功能重构**：优化依赖管理与配置向导的分工，减少功能重复

## 2026-04-18 — 安装向导问题修复
- **修复winetricks安装流程**：修复输入密码后卡住的问题，确保密码验证后能正确安装winetricks并继续依赖安装
- **新增全局跳过功能**：添加整个安装向导的跳过功能，用户可在任何步骤选择跳过wine、proton、依赖等所有配置步骤
- **改进用户体验**：在导航栏添加全局跳过按钮，支持在任何步骤快速跳过整个安装过程

## 2026-04-18 — 密码验证问题修复
- **修复密码错误提示问题**：修复前端调用 install_winetricks 但后端未注册 IPC 处理函数的问题
- **改进错误处理**：后端正确识别密码错误类型（"Sorry, try again"、"incorrect password"、"Authentication failure"）
- **完善IPC通信**：添加 install_winetricks IPC 处理函数，确保密码验证流程正常

## 2026-04-18 — 需求调整：移除步骤4跳过功能
- **简化跳过功能**：根据PRD要求，移除步骤4"跳过依赖安装"功能，只保留全局跳过功能
- **代码清理**：移除相关状态变量、确认对话框、跳过按钮和提示框
- **保持一致性**：确保跳过功能只在向导底部导航栏提供，避免功能重复

## 2026-04-18 — 需求调整：帮助页面快速更新入口改为跳转
- **修改导航逻辑**：将About页面的"检查更新"按钮改为跳转到"版本更新"页签
- **路由状态传递**：通过路由状态传递activeTab参数，自动切换到更新页签
- **简化功能**：移除About页面中的直接版本检查功能，避免功能重复
- **用户体验优化**：用户点击后直接进入完整的版本更新界面，提供更多功能选项

## 2026-04-18 — 需求调整：环境设置向导结构优化
- **步骤重构**：将原5个步骤优化为4个步骤，提升用户体验
- **步骤1：确认中间层** - 合并原步骤1（环境检查）和步骤2（选择Proton），统一检测Wine、winetricks、Proton等中间层环境
- **步骤2：确认依赖** - 保持不变，专注于Windows运行时组件选择
- **步骤3：路径选择** - 优化为配置下载内容保存路径，包括中间层安装路径、依赖缓存路径、临时下载目录
- **步骤4：执行安装** - 保持不变，负责最终安装执行
- **产品命名优化**：对步骤名称进行产品性优化，提升用户理解度
- **功能整合**：减少步骤数量，简化用户操作流程，提高向导效率

## 2026-04-18 — 设置界面与依赖管理重构
- **设置分区重划分**：严格按照 PRD v1.2 重新划分"设置"页下的子功能；"基础设置"页签改为立即生效（防抖 500ms 自动保存），不再提供"保存设置"按钮；移除了路径配置、重置 Wine Prefix、重新配置环境这三类入口
- **依赖管理重构**：将全部日常维护能力收敛到"依赖管理"子页签，顶部工具栏新增"重新配置环境"（重新打开 SetupWizard）
- **新增中间层管理**：新增 `MiddlewareManager` 区块，支持 Wine / winetricks / Proton 的扫描/切换/自定义路径/删除（用户目录下的 Proton）/下载（GE-Proton 一键安装、winetricks 脚本一键安装到 `~/.local/bin`）
- **自定义路径迁移**：将 Wine 前缀路径与 WeGame 安装路径从基础设置迁移到依赖管理，并加上修改前缀路径的二次确认提示
- **重置 Prefix 迁移**：将"重置 Wine Prefix"从基础设置迁移到依赖管理的"危险操作区"
- **后端新增模块 `electron/backend/middleware.ts`**：封装 `deleteProtonVersion`、`downloadAndInstallGeProton`、`installWinetricksUserlocal`，并通过 `middleware-download-progress` 事件上报下载/解压进度
- **IPC 新增接口**：`delete_proton_version`、`fetch_latest_ge_proton`、`download_ge_proton`、`install_winetricks_userlocal`
- **修复潜在 bug**：`installWinetricks` 在 `ipc.ts` 中此前未正确 import，导致 `install_winetricks` handler 运行时报错，本次一并修复
- **关键文件**：`PRD.md`、`DEVLOG.md`、`src/pages/Settings.tsx`、`src/pages/Dependencies.tsx`、`src/pages/SettingsPage.tsx`、`src/utils/api.ts`、`src/types/index.ts`、`electron/ipc.ts`、`electron/backend/middleware.ts`

## 2026-04-18 — Bug 修复：依赖安装失败 `wineserver not found`
- **问题现象**：点"安装缺失项"后进度条前进，但每一项 winetricks 安装都失败；日志反复出现 `warning: wineserver not found!`，退出码 1
- **根因**：SteamOS / Steam Deck 系统里没有独立的 `wine` / `wineserver`（wine 藏在 Proton 目录里），而 `runWinetricksSingle` 只用了 `process.env + WINEPREFIX`，没把所选 Proton 的 `files/bin` 注入到子进程 `PATH`，winetricks 找不到 wine 后端
- **方案（PRD v1.3 §4.2.2.1）**：依赖安装始终使用当前所选 Proton 内置的 wine/wineserver
  - 新增 `resolveWineBackendEnv(config)`：解析 `<ProtonDir>/files/bin` 或 `<ProtonDir>/dist/bin`，校验 `wineserver` 存在，产出完整 env（`PATH`、`WINE`、`WINE64`、`WINELOADER`、`WINESERVER`、`WINEARCH`、`WINEDLLPATH`）
  - `installDependencies` 在开头解析后端 env，**解析失败立即中止并向前端上报清晰错误**，不再跑完所有项制造假失败
  - `runWinetricksSingle` 使用注入后的 env 启动 winetricks
  - `checkInstalledWinetricks` 同步使用 Proton 注入 env（查询 list-installed 也需要 wine）
  - `ipc.ts` 把 `config` 透传给 `installDependencies` 和 `getDependencyList`
- **与启动器的一致性**：依赖安装使用的 wine 版本 = 启动 WeGame 使用的 wine 版本（都来自 `config.proton_path`），避免 prefix 状态错乱
- **关键文件**：`PRD.md`、`DEVLOG.md`、`electron/backend/dependencies.ts`、`electron/ipc.ts`

## 2026-04-18 — Bug 修复：依赖安装卡在第一步不动（winetricks hang）
- **问题现象**：Wine 后端已经成功注入，但 `[1/13] Installing: dotnet46` 后只打了一行 `Executing cd /usr/local/bin` 就不动了，没有任何进展
- **根因**（多重因素叠加）：
  1. `winetricks --unattended` 强度不够，遇到 EULA 提示仍可能 fallback 到 GUI；没 DISPLAY 时又 fallback 到 stdin，直接阻塞
  2. 未禁 winetricks 自检更新，启动阶段会访问 GitHub，受网络环境影响可能 hang 数分钟
  3. 未设置 `LD_LIBRARY_PATH`，Proton 自带 wine 找不到 `files/lib64` / `files/lib` 里的 libwine.so 等私有库，静默卡死在 wine 启动阶段
  4. 子进程 stdin 默认继承，winetricks 可能阻塞读 stdin
  5. 长时间下载（如 dotnet46 拉 ~60MB）时 winetricks 不打印任何日志，UI 看起来像死了
- **修复**：
  - 新增 env：`W_OPT_UNATTENDED=1`、`WINETRICKS_GUI=none`、`WINETRICKS_LATEST_VERSION_CHECK=disabled`、`WINEDEBUG=-all`
  - 新增 `LD_LIBRARY_PATH`：注入 `<ProtonDir>/files/lib64:<ProtonDir>/files/lib`（兼容 `dist/` 旧版）
  - `runWinetricksSingle` 明确 `stdio: ["ignore", "pipe", "pipe"]`，切断 stdin
  - 新增 15 秒心跳日志，IDLE 时上报"仍在运行中（下载中属正常）"，避免 UI 误判卡死
  - 增加 spawn 启动调试日志（打印 WINEPREFIX / 无人值守开关）
- **关键文件**：`DEVLOG.md`、`electron/backend/dependencies.ts`

## 2026-04-18 — PRD v1.4 重大策略调整：依赖最小化 + 镜像源兜底 + 运行诊断
- **背景**：实测 WeGame 能启动，但安装进度卡 0% 不动。同时依赖安装屡屡失败（微软 CDN 证书不被信任、`web.archive.org` IPv6 网络不可达）。这两类现象说明当前"一次性预装一堆 Windows 依赖"的策略既不解决真实问题，又制造新问题。
- **关键技术决策**：
  1. **依赖最小化**：WeGame 主体是 C++/Qt，不依赖 .NET；Proton-GE 已内置 vcrun/d3dx9/corefonts 等常用依赖；.NET 在 Wine 64bit prefix 下长期不稳定。因此默认勾选依赖从 13 项缩减到 2 项（`corefonts` + `cjkfonts`），其余全部"按需安装"。
  2. **镜像源策略**：winetricks 上游源（微软/Google/web.archive）在国内 Steam Deck 上基本不可用，新增 `electron/backend/mirrors.ts` 统一管理镜像源；依赖安装前尝试从国内镜像/GitHub Release（ghproxy 反代）**预置文件到 `~/.cache/winetricks/<verb>/`**，让 winetricks 跳过下载步骤。失败时静默降级到 winetricks 原生路径，不阻塞主流程。
  3. **WeGame 运行诊断**：新增 `electron/backend/diagnostics.ts`，6 项独立并行检测（DNS 污染、HTTPS 证书链、CA 证书包、TenioDL 进程、WeGame 日志目录、Proton 版本新旧），输出结构化 `DiagnosticReport`；前端新建 `src/components/DiagnosticsPanel.tsx` 作为 Modal 面板，挂到依赖管理页顶部工具栏。支持导出 Markdown 报告便于社区反馈。
- **实现要点**：
  - `constants.ts` / `electron/backend/dependencies.ts` 双向同步调整 `required` 字段；`Dependencies.tsx` 移除硬编码 `ALL_DEPS` 副本，改为复用 `DEPENDENCY_LIST`（单一事实来源）
  - `installDependencies` 主循环前插入 `preseedWinetricksCache` 调用（best-effort、异常不阻断）
  - 镜像下载器自带 HTTP 重定向跟随、超时控制、sha256 校验（可选）、多源降级
  - 诊断模块使用 `curl`（SteamOS 必备）做 HTTPS 可达性检测，严格控制每项检查 5 秒内完成
  - IPC 新增接口：`run_wegame_diagnostics`
- **FAQ 同步更新**："WeGame 0% 卡住"条目从"去装更多依赖"改为"检查 DNS/证书，使用运行诊断"
- **关键文件**：`PRD.md`（v1.3 → v1.4，新增 §4.2.2.2 / §4.7 / §5.5）、`DEVLOG.md`、`src/utils/constants.ts`、`electron/backend/dependencies.ts`、`electron/backend/mirrors.ts`（新）、`electron/backend/diagnostics.ts`（新）、`electron/ipc.ts`、`src/utils/api.ts`、`src/components/DiagnosticsPanel.tsx`（新）、`src/pages/Dependencies.tsx`
