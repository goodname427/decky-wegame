# 开发日志 (Development Log)

本文件记录 WeGame Launcher 项目的**关键架构变更、重大技术决策和会改变用户预期行为的核心修复**。

> 编写约束：**不写流水账** —— 简单 bug 修复、琐碎 refactor、文件移动等由 `git log` 承担；DEVLOG 面向"半年后的自己或新加入的维护者"，需要能凭此快速还原某次关键改动的来龙去脉。

---

## 2026-04-18 — 修复残缺 Wine 前缀导致 WeGame 安装器 `c0000135` 卡死（v1.8.2）
- **问题现象**：点「选择本地安装器文件」运行 `WeGameSetup.exe` 时，installer 日志反复出现 `wine: could not load kernel32.dll, status c0000135` 与 `installer exited with code=53`；即便手动 `rm -rf` 整个 prefix 后重装，应用重新跑完 `wineboot --init`，现象仍不消失。
- **根因**：`ensureWinePrefixInitialized` 原本只用单文件哨兵 `syswow64/regedit.exe` 判断前缀是否已初始化。现场命中了两种退化场景：(a) 哨兵文件存在但 `kernel32.dll` 缺失；(b) 前缀被以 32-bit 模式建好（只有 `system32/` 没有 `syswow64/`），哨兵直接不存在但 wine64 启动仍失败。第二种情况还会被 wineboot 自身误判为"已有前缀、不需要重建"从而卡住。
- **方案（粗暴但可预期）**：
  - 把哨兵升级为**三文件健康检查**：`syswow64/regedit.exe`、`syswow64/kernel32.dll`、`system32/kernel32.dll` 必须同时存在，任一缺失即视为前缀残缺。
  - 前缀残缺时**直接 `rm -rf` 整个前缀目录**再重跑 `wineboot --init`（默认 prefix 位于 `~/.local/share/decky-wegame/prefix`，按约定由本应用独占，纵向清理安全）。
  - wineboot 的 bootEnv 里**显式固定 `WINEARCH=win64`**，阻断外部 shell 可能注入的 `WINEARCH=win32` 污染。
  - wineboot 返回后**再跑一次健康检查**，失败就抛出包含缺失文件列表的错误，不让后续步骤踩入必死的 `c0000135`。
- **关键决策**：选择"粗暴清空 + 全量重建"而不是"只清 `drive_c/`、保留用户文件"。前缀根目录按项目约定是纯 wine 目录，没有用户自有数据，用粗暴方案可最大程度保证 wineboot 的可重复性，避免遗留残渣再次造成退化。
- **关键文件**：`electron/backend/dependencies.ts`（新增 `collectPrefixHealthStatus`、重写 `ensureWinePrefixInitialized`）、`PRD.md`（§4.1 step 3）、`README.md`、`package.json`、`DEVLOG.md`


## 2026-04-16 ～ 2026-04-17 — 项目初始化与技术栈确立

- **项目目标**：在 SteamOS / Steam Deck 上运行腾讯 WeGame 平台及其游戏。
- **核心架构决策（Tauri → Electron）**：最初采用 React + Tauri + Rust 的技术栈，但 Tauri 依赖 WebKitGTK / EGL，在 Steam Deck 上存在长期无法解决的兼容性问题（白屏、EGL 初始化失败等）。最终迁移到 Electron：自带 Chromium，不依赖系统 WebView；前端 React/TS 代码零改动，后端逻辑从 Rust 改为 Node.js/TypeScript，通过 IPC + contextBridge preload 对接。
- **首版功能骨架**：4 个顶层页签（Dashboard / Launcher / Settings / About）、首次启动自动弹 SetupWizard 环境向导、按模块拆分的会话级日志系统、依赖扫描 / 安装 / 跳过体系、双渠道更新检查。
- **早期迭代**（不逐条记录）：包含 wizard 结构若干次调整、winetricks 密码流程的 IPC 注册补齐等小修正；详情可在 `git log` 中检索。

## 2026-04-18 — 设置界面与依赖管理重构（v1.2）
- **设置分区重划分**：严格按照 PRD v1.2 重新划分"设置"页下的子功能；"基础设置"页签改为立即生效（防抖 500ms 自动保存），不再提供"保存设置"按钮；移除了路径配置、重置 Wine Prefix、重新配置环境这三类入口
- **依赖管理重构**：将全部日常维护能力收敛到"依赖管理"子页签，顶部工具栏新增"重新配置环境"（重新打开 SetupWizard）
- **新增中间层管理**：新增 `MiddlewareManager` 区块，支持 Wine / winetricks / Proton 的扫描/切换/自定义路径/删除（用户目录下的 Proton）/下载（GE-Proton 一键安装、winetricks 脚本一键安装到 `~/.local/bin`）
- **自定义路径迁移**：将 Wine 前缀路径与 WeGame 安装路径从基础设置迁移到依赖管理，并加上修改前缀路径的二次确认提示
- **重置 Prefix 迁移**：将"重置 Wine Prefix"从基础设置迁移到依赖管理的"危险操作区"
- **后端新增模块 `electron/backend/middleware.ts`**：封装 `deleteProtonVersion`、`downloadAndInstallGeProton`、`installWinetricksUserlocal`，并通过 `middleware-download-progress` 事件上报下载/解压进度
- **IPC 新增接口**：`delete_proton_version`、`fetch_latest_ge_proton`、`download_ge_proton`、`install_winetricks_userlocal`
- **修复潜在 bug**：`installWinetricks` 在 `ipc.ts` 中此前未正确 import，导致 `install_winetricks` handler 运行时报错，本次一并修复
- **关键文件**：`PRD.md`、`DEVLOG.md`、`src/pages/Settings.tsx`、`src/pages/Dependencies.tsx`、`src/pages/SettingsPage.tsx`、`src/utils/api.ts`、`src/types/index.ts`、`electron/ipc.ts`、`electron/backend/middleware.ts`

## 2026-04-18 — 依赖安装失败根因修复：Proton 后端注入 + winetricks 无人值守化（v1.3）
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

## 2026-04-18 — 依赖安装 hang 根因修复：winetricks env + LD_LIBRARY_PATH（v1.3 补强）
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

## 2026-04-18 — 重大策略调整：依赖最小化 + 镜像源兜底 + 运行诊断（v1.4）
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

## 2026-04-18 — 性能优化：消除"进依赖管理页卡 2~5 秒"问题（v1.5）
- **问题现象**：每次打开"设置 → 依赖管理"（即默认子页签）都会有 2~5 秒无法点击任何按钮，所有 IPC 调用像被冻住
- **根因**：`Dependencies.tsx` 挂载时同步拉取 `get_dependency_list`，IPC handler 内部用 `execSync("winetricks list-installed")` 查询 prefix 已安装包。该命令会触发 wine + wineserver 冷启动 + 注册表读取，单次耗时 2~5 秒；而 `execSync` 会**阻塞 Electron 主进程事件循环**，期间所有 IPC 消息队列全部卡住 → 整个界面假死
- **修复策略（PRD v1.5 §4.2.2.3）**：
  1. **后端内存缓存**：以 `WINEPREFIX` 为 key 缓存 `Set<string>` 已安装包列表。缓存命中时立即返回，不启动 winetricks 子进程
  2. **后端异步化**：新增 `checkInstalledWinetricksAsync`，用 `spawn` 取代 `execSync`，Promise 包装，带 20 秒硬超时兜底；原 sync 版本保留给遗留调用者
  3. **自动失效**：`installDependencies` 结束（无论成功/部分/失败）时调用 `invalidateDependencyCache(winePrefixPath)`；`reset_environment` IPC handler 中也主动 invalidate
  4. **手动刷新**：新增 IPC `refresh_dependency_list`（绕过缓存），前端工具栏新增「刷新状态」按钮
  5. **前端占位渲染**：页面挂载立即用 `DEPENDENCY_LIST` 默认数据渲染（`installed: false`），用户可瞬时操作；真实状态在后台异步刷新完成后平滑合并；工具栏标题右侧显示「正在刷新状态…」提示
- **关键技术决策**：
  - 缓存策略**不使用 TTL**（基于时间的过期），只在明确状态变化时 invalidate，避免无意义的 winetricks 调用
  - 异步版本即使 wineserver 冷启动卡死也不会冻住 UI（Promise 延迟 resolve，其余 IPC 正常流转）
  - 保留 sync `getDependencyList` 导出，避免破坏潜在的其他调用点
- **验收标准**：首次冷启动 <200ms 可交互（占位先显示），之后进入 <50ms（缓存命中，几乎瞬时显示正确状态）；任何时刻其他 IPC 调用不会被依赖查询阻塞
- **关键文件**：`PRD.md`（新增 §4.2.2.3；Changelog v1.5）、`DEVLOG.md`、`electron/backend/dependencies.ts`、`electron/ipc.ts`、`src/utils/api.ts`、`src/pages/Dependencies.tsx`

## 2026-04-18 — 修复"点击启动 WeGame 没反应"（v1.6）
- **问题现象**：用户在 Launcher 页点「启动 WeGame」后界面无任何反馈，也找不到 launcher.log；Dashboard 的相同按钮同样静默
- **根因**：
  1. `handleLaunchWeGame` 只在错误分支 `console.error`，没有 UI 反馈，用户完全看不到 IPC 抛错的信息
  2. 启动成功时是 `detached` 进程，若秒退（prefix 损坏 / 依赖缺失 / Proton 不兼容）也没提示
  3. 启动前没有 loading 态，用户会连点，且无从判断是不是点中了
  4. 用户不知道日志文件路径，即使想排查也找不到入口
- **修复策略（PRD v1.6 §4.3.1）**：
  1. **即时 loading**：启动/停止按钮按下立即进入 `disabled + Loader2 animate-spin + "启动中…/停止中…"` 态
  2. **错误红色横幅**：捕获 IPC 异常，把 `err.message` 完整文本放在页面顶部红色 banner，附 `~/.local/share/decky-wegame/logs/launcher.log` 路径提示
  3. **3 秒探测**：启动成功返回后等 3 秒，重新 `invoke("get_wegame_status_cmd")`；若进程已不在 → 黄色警示 banner，提示可能是 prefix/依赖/Proton 原因，并指向 launcher.log 里的 `[stderr]` 与 `exited with code` 关键词
  4. **可关闭**：banner 右上角 × 按钮，用户也可被新 banner 覆盖
  5. Dashboard 页面的启动/停止快捷入口同步改造
- **关键技术决策**：
  - 探测间隔选 3 秒而不是 1 秒：Proton 冷启动 + wine prefix 初次加载需要 2~3 秒，过短会误判为"秒退"
  - 探测阶段用 IPC 直接查 `get_wegame_status_cmd` 拿新值，而不是依赖闭包里的 `status`（避免 stale state）
  - Banner 类型分 `error`（红）/`warning`（黄），语义清晰：一个是没起来，一个是起来但没活下来
  - Error banner 保留直到下次成功操作或用户手动关闭，不自动消失 → 用户有时间复制错误信息
- **不做的事**：暂不做 toast 库依赖；暂不在后端加心跳探测（3 秒足够覆盖 95% 场景）
- **关键文件**：`PRD.md`（新增 §4.3.1；Changelog v1.6）、`DEVLOG.md`、`src/pages/Launcher.tsx`、`src/pages/Dashboard.tsx`

## 2026-04-18 — 安装向导新增"安装 WeGame"步骤 + 根因修复字体安装失败（v1.7）

### 背景
v1.6 修好"启动无反应"的 UI 反馈问题后，真正的根因暴露出来：
1. 启动报 `WeGame executable not found` — **向导从未有"安装 WeGame"步骤**，用户跑完向导 prefix 里根本没有 WeGameLauncher.exe
2. `winetricks corefonts / cjkfonts` 全部失败于 `c0000135 (DLL_NOT_FOUND)` — `syswow64/regedit.exe` 不存在，说明 prefix 还未经 wineboot 初始化
3. 诊断面板在 `config.proton_path` 有值时仍误报"未选择或找不到 Proton" — 诊断函数读 `config` 时机早于前端加载完成

### 变更（四合一）

#### M1：依赖策略进一步最小化（字体改为完全按需）
- 背景：实机日志证明新版 winetricks（20260125-next）+ GE-Proton7-20 + 全新 prefix 跑 `corefonts/cjkfonts` 必踩 `c0000135` 坑，而 Proton-GE 本身已能正常渲染中文
- `src/utils/constants.ts` / `electron/backend/dependencies.ts`：`font-microsoft-core` 与 `font-cjk` 的 `required` 从 `true` 改 `false`
- 分组注释从"推荐（默认勾选）"挪到"按需（默认不勾选）"；描述注明"Proton-GE 通常已能正常渲染，仅在方块/乱码时补装"

#### M2：向导新增步骤 5「安装 WeGame」
- 后端新增 `electron/backend/wegame_installer.ts`：
  - `getInstallerInfo`：返回本地缓存路径/是否已缓存/大小/默认下载 URL
  - `isWegameInstalled`：按 `<prefix>/drive_c/Program Files/Tencent/WeGame/WeGameLauncher.exe` 等 4 条路径探测
  - `downloadWegameInstaller`：HTTPS 跟随重定向下载到 `~/.cache/decky-wegame/installers/WeGameSetup.exe`（默认腾讯官方 `dldir1.qq.com` 源，支持 `extra_env_vars.WEGAME_INSTALLER_URL` 覆盖）
  - `runWegameInstaller`：调 `resolveWineBackendEnv` + `ensureWinePrefixInitialized`，spawn `wine64 WeGameSetup.exe`，5s 心跳把进度推进到 80% 上限，进程结束后用 `isWegameInstalled` 二次校验才判定成功
  - `downloadAndInstallWegame`：向导主流程入口（已缓存则跳过下载）
  - `clearInstallerCache`：失败时清缓存重下
- 新增 5 个 IPC：`get_wegame_installer_info` / `check_wegame_installed` / `download_wegame_installer` / `run_wegame_installer` / `install_wegame` / `clear_wegame_installer_cache`，进度通过 `wegame-install-progress` 事件广播
- 新增 `installerLogger`（单独输出到 `logs/installer_*.log`），与 `dependencies_*.log` 区分，便于后续排错
- `src/pages/SetupWizard.tsx`：
  - `STEPS` 加第 5 项"安装 WeGame"；`canProceed` 加 `case 5: return true`
  - 监听 `wegame-install-progress` 事件驱动 UI 阶段 / 进度 / 消息 / 错误
  - 步骤 4 `progress.status==="completed"` 时自动推进到步骤 5 并预先探测安装状态
  - 步骤 5 UI：已安装 → 绿色卡片 + "重新下载并安装"；未安装 → 黄色卡片 + "下载并安装 WeGame"；进行中 → 进度条 + "请在 GUI 向导里完成步骤"提示；失败 → 红色卡片 + 「重试 / 清缓存重下」
  - 底部导航栏的"步骤 X / 4"改为 "X / 5"（用 `totalSteps`），"完成"按钮仅在步骤 5 展示（文字随 `wegameInstalled` 切换为「完成」或「稍后安装并完成」），步骤 4 的"下一步"被 `progress.status !== "completed"` 禁用防止用户跳过依赖安装
- `src/pages/Launcher.tsx`：错误 banner 支持 `actions[]`，当错误文本含 "WeGame executable not found" 时标题切为「尚未安装 WeGame」，并附直达按钮"打开配置向导"（dispatch `open-setup-wizard` 自定义事件）
- `src/App.tsx`：监听 `open-setup-wizard` 事件打开向导（避免把 `onOpenSetupWizard` callback 一级级穿到 Launcher）

#### M3：修复 `proton-version` 诊断误报
- `electron/backend/diagnostics.ts` 的 `checkProtonVersion` 增加自动回退：`config.proton_path` 为空/失效时调用 `scanProtonVersions() + getDefaultProtonPath()`，与 `resolveWineBackendEnv` 行为对齐
- 命中自动回退时在 `message` 后附"（自动检测）"标识，避免用户误解诊断结果

#### M4：依赖安装前强制保证 prefix 已初始化
- `electron/backend/dependencies.ts` 新增 `ensureWinePrefixInitialized`：
  - 快速路径：`drive_c/windows/syswow64/regedit.exe` 存在 → 立即返回
  - 否则：用同一份 `resolveWineBackendEnv` 产出的 env 跑 `wine64 wineboot --init`；180 秒硬超时 + 60 秒空闲杀进程；即使退出码非零，只要 `regedit.exe` 最终出现也视为成功
  - 末尾再跑 `wineserver -w` 等待 prefix 完全就绪，避免 winetricks 与 wineserver race
- `installDependencies` 在 `resolveWineBackendEnv` 之后立即调用该函数，失败则 emit error 终止，不再盲目进入 winetricks 循环
- `wegame_installer.runWegameInstaller` 也复用此函数，保证第一次跑安装器时 prefix 已就绪

### 关键技术决策
- **WeGame 下载不让用户提供源**：默认固化腾讯官方 `dldir1.qq.com`，但保留 `WEGAME_INSTALLER_URL` 覆盖位，供内部测试/镜像用
- **安装进度的"心跳"策略**：安装器是 Windows GUI，不可能拿到真实进度；选 5 秒一跳、上限 80%，让用户看到"东西在走"且最后 20% 留给后置校验阶段
- **判定"安装成功"只以文件存在为准**：不少 wine GUI 安装器退出码不稳（警告也可能非零），唯一可靠信号是 `WeGameLauncher.exe` 是否出现
- **全局事件而非 prop-drilling**：`open-setup-wizard` 自定义事件避免为一个一次性按钮修改 4 层组件签名
- **字体彻底改按需，不再"保留推荐"**：实机证据太硬（每次都 c0000135），保留推荐反而会让新用户第一次装就失败；老用户可以手动去依赖管理勾

### 不做的事
- 不在向导里提供"浏览本地 .exe"选项（backend 已具备 `run_wegame_installer(installerPath)` 能力，但 UI 先保持简单，v1.8 视需要再加）
- 不把 WeGame 安装器内置到应用包里（体积巨大、版权、版本过时问题）
- 不做静默/自动化点击"下一步"（依赖 xdotool/wine 版本兼容性差，维护成本太高）

### 关键文件
- 新增：`electron/backend/wegame_installer.ts`
- 修改：`PRD.md`（向导 4→5 步；Changelog v1.7；依赖分层表；步骤 4 wineboot 说明；新增步骤 5 完整规格 + IPC 表）、`DEVLOG.md`、`electron/backend/dependencies.ts`（M1 + M4）、`electron/backend/diagnostics.ts`（M3）、`electron/backend/logger.ts`（新增 `installerLogger`）、`electron/ipc.ts`（注册 5 个新 IPC）、`src/utils/constants.ts`（M1）、`src/utils/api.ts`（6 个新 API 封装）、`src/pages/SetupWizard.tsx`（步骤 5 全部逻辑）、`src/pages/Launcher.tsx`（错误 banner actions）、`src/App.tsx`（全局事件监听）

## 2026-04-18 — 修复"0 依赖无法进入步骤 5"回归（v1.7.1）

### 背景
v1.7 把 `corefonts` / `cjkfonts` 改成默认不勾选后，立刻暴露出一条回归：
- 步骤 2 默认 `selectedDeps` 为空
- 步骤 4 的 `canProceed` 仍按旧规则 `case 4: return selectedDeps.length > 0`
- 结果「开始安装」与「下一步」双双被禁用 → 用户**永远走不到步骤 5**，必须倒回去勾一个无用依赖才能推进

### 变更
- `src/pages/SetupWizard.tsx`：
  - `canProceed()` 的 `case 4` 改为 `return true`（v1.7 默认就是 0 依赖，这里不该再卡）
  - `handleFinish()` 把 `selectedDeps.length === 0` 与 `globalSkipped` 合并到同一分支：调用 `skip_dependency_installation`，**不再触发 sudo 密码弹窗**（0 依赖根本用不着 winetricks）。该 IPC 会广播 `status: "completed"` 的 `install-progress` 事件，现有 useEffect 自然地把步骤推进到 5
  - 步骤 2 底部统计条在 0 依赖时显示"推荐默认：Proton-GE 已自带常用依赖，下一步会跳过 winetricks 阶段" + "无需额外空间"
  - 步骤 4 的标题 / 副标题 / 按钮文案按 `selectedDeps.length === 0` 差异化：
    - 标题 "开始安装" → "准备完成环境配置"
    - 副标题说明仅创建 Wine 环境并直接进入下一步
    - 按钮 "🚀 开始安装" → "→ 创建环境并继续"（避免用户误以为要跑 winetricks）

### 关键技术决策
- **复用后端已有的 `skip_dependency_installation`**：不新增 IPC，因为它本就在发完成事件，只是原本只给"点了全局跳过"的用户用。这里只是扩大了它的使用面（"0 依赖" = "没什么要 skip 的，但语义上等价于 skip winetricks 阶段"），零后端改动
- **不降低步骤 4 可见度**：没有选择让步骤 4 在 0 依赖时自动跳过，因为步骤 4 还承担"保存配置 / 创建 prefix / wineboot --init"三件事，这些对用户来说是**可感知的等待**，需要保留进度条
- **文案做差异化而非删 UI**：让用户看见按钮变了（"创建环境并继续"而不是"开始安装"），避免用户以为"啥都没做怎么就下一步了"的困惑

### 不做的事
- 不改 `skip_dependency_installation` 的后端实现（它的名字虽然看起来窄，但事件语义是"依赖阶段结束"，仍然适用）
- 不在步骤 5 弹出"刚才没装依赖，确认要装 WeGame 吗"二次确认（徒增步骤；WeGame 本身装依赖依赖的是 prefix，不是 winetricks 的那些 verb）

### 关键文件
- 修改：`src/pages/SetupWizard.tsx`（canProceed / handleFinish / 步骤 2 统计条 / 步骤 4 标题与按钮）
- 同步：`package.json` v1.7.0 → v1.7.1、`README.md`（版本号 + 步骤 4 描述）、`PRD.md`（版本号 + Changelog 补 v1.7 与 v1.7.1 两行 + 步骤 4 0 依赖分支说明）、`DEVLOG.md`（本条目）

## 2026-04-18 — 「安装向导」与「依赖管理页」配置一致性重构（v1.8.0）

### 背景
用户反馈：「向导里能做的事和依赖管理页能做的事不完全对等，体验割裂」。具体对账下来发现：

| 能力 | 向导（v1.7） | 依赖管理页（v1.7） |
|---|---|---|
| 选 Proton | ✅ 下拉选择 | ✅ 下拉选择 |
| **下载最新 GE-Proton** | ❌ 没有入口 | ✅ 有按钮 |
| 删除用户持有的 Proton | ❌ | ✅ |
| 编辑 Wine Prefix 路径 | ✅ 但无"修改警告" | ✅ 有二次确认 |
| 编辑 WeGame 安装路径 | ⚠️ label 写的是「依赖缓存路径」，但实际写入 `wegame_install_path`——**字段错位 bug** | ✅ 正确标注 |
| **winetricks 一键到 ~/.local/bin（免密）** | ❌ 只在执行阶段通过 `installWinetricks`（需 sudo）安装 | ✅ 有按钮 |
| WeGame 本体安装 / 重装 | ✅ 在 step 5 全套 UI + 事件订阅 | ❌ 只能重走向导 |
| 单项依赖"重装" | ❌ | ❌ |

根本原因是向导与管理页**各自实现了一份 UI**，代码重复 + 长期漂移。此次做**组件层面的统一**。

### 变更概览（3 个 commit）

**Commit 1：抽取 3 个共享组件** → `src/components/config/`
- `PathsSection.tsx`（140 行）：Wine Prefix + WeGame 安装路径编辑，`variant: "wizard" | "panel"`。wizard 模式下通过 `onLocalChange` 将变更回传父级暂存（等用户点"下一步"才落盘），panel 模式下防抖 500ms 自动落盘
- `ProtonPicker.tsx`（198 行）：Proton 列表 + 选择 + 下载 GE-Proton + 删除用户持有版本。内置 `middleware-download-progress` 订阅，可在两种形态下独立工作
- `WeGameInstaller.tsx`（415 行）：WeGame 安装/重装/清缓存。`variant: "wizard" | "manage"`。新增 `onStatusChange` 回调让向导无需自行订阅 IPC 事件也能感知 installed 状态（用于 "完成 / 稍后安装并完成" 按钮文案判断）
- Dependencies 页面切换到共享组件：去掉原内嵌的 `CustomPaths` 本地实现 + Proton 行为块（-234 行）

**Commit 2：SetupWizard 接入共享组件 + 补齐能力**
- Step 1 Proton 视图：用 `<ProtonPicker variant="wizard">` 替换原 90 行本地 UI；现在**向导里也可一键下载 GE-Proton**
- Step 1 winetricks "下载安装" 分支：追加「立即下载到 ~/.local/bin（无需密码）」按钮，成功后自动 `runScan()` 让依赖标记自动翻绿；**与依赖管理页的 `install_winetricks_userlocal` 入口对等**
- Step 3 路径字段：用 `<PathsSection variant="wizard">` 替换；顺手修了 label 错位 bug（原先第二个输入框标「依赖组件缓存路径」却绑定 `wegame_install_path`）
- Step 5 WeGame 安装：整段 150+ 行 UI 换为 `<WeGameInstaller variant="wizard">`；删除向导内的 `wegameInstalled/wegameExePath/wegameInstalling/wegamePhase/wegamePercent/wegameMessage/wegameError` 7 个状态、`handleInstallWegame/handleReinstallWegame` 2 个 handler、1 个 `wegame-install-progress` 订阅 effect，只保留 `wegameInstalled: boolean | null`（用于 footer 按钮文案）
- 净效果：`SetupWizard.tsx` 1155 → 864 行（**-291 行重复 UI**）

**Commit 3：依赖管理页补齐 + 文档与版本号同步**
- Dependencies 页在 PathsSection 下方新增 `<WeGameInstaller variant="manage">` 卡片：展示 WeGame 安装状态、直接「下载并安装」/「重新安装」/「重试」，**不再需要重走向导**
- 依赖列表项 hover 时多出"重装"迷你按钮（只对 `dep.installed === true` 显示），调用 `start_install_dependencies` 并传单个 `selectedIds: [dep.id]`；**不必再点"全部重装"**
- 同步 `package.json` v1.7.1 → v1.8.0
- README：版本号、功能特性段新增「配置一致性（v1.8 重构）」「WeGame 本体管理」两项、使用说明段刻画向导新增能力
- PRD：顶部元信息升版、新增 §4.2.6「配置一致性」章节（表格约定 3 个共享组件、向导侧/管理页侧的能力补齐清单、禁止"复制粘贴 UI"的新约束）、Changelog 表加 v1.8.0 条目

### 关键技术决策
- **三组件而非一组件**：起初考虑合成一个 `<ConfigForm>` 大组件，但 Proton 和 WeGame 安装的事件流差别太大（一个监听 `middleware-download-progress`，一个监听 `wegame-install-progress`），强合一会让 props 爆炸；拆三个刚好对应 3 个**独立的 IPC 事件通道**，边界清晰
- **`variant` 而非 `isWizard`**：未来若出现第三个入口（如"欢迎页快速设置"），`variant` 能平滑扩展，而布尔量需要重构
- **`onLocalChange` vs 直接写盘**：wizard 把"路径变更"视为暂存，直到用户点"下一步"才真正调用 `save_config_cmd`，避免向导中途返回会留下脏配置；panel 则沿用 v1.7 已验证的防抖自动保存体验
- **`onStatusChange` 让向导"旁观"installer**：向导只需要知道 installed=true/false 来切 footer 文案；安装的错误/重试/事件订阅全部在共享组件内自闭环，向导保持清爽

### 不做的事
- 不为"向导里的 `<PathsSection>`"自动建立新 prefix 目录——该动作仍归 step 4 的 `handleFinish`（避免 step 3 就副作用）
- 不把「中间层管理 / Wine / winetricks 区块」也拆到共享组件里——向导 step 1 已经用扫描卡展示了它们，重复度尚可接受，且二者交互模型不完全对称（向导是"一次性扫描 + 决策"，管理页是"持续可复扫"）；留作后续必要时再抽

### 关键文件
- 新增：`src/components/config/PathsSection.tsx`、`src/components/config/ProtonPicker.tsx`、`src/components/config/WeGameInstaller.tsx`
- 修改：`src/pages/SetupWizard.tsx`（1155 → 864 行）、`src/pages/Dependencies.tsx`（802 → 610 行）
- 同步：`package.json` v1.7.1 → v1.8.0、`README.md`（版本号 / 功能特性 / 使用说明）、`PRD.md`（版本号 + §4.2.6 新章节 + Changelog v1.8.0 条目）、`DEVLOG.md`（本条目）

## 2026-04-18 — 修复 WeGame 安装器下载 404，改为「本地文件优先 + 多源兜底」（v1.8.1）

### 背景
用户反馈：点击「下载并安装 WeGame」报 404。直接探测：

```
$ curl -sI 'https://dldir1.qq.com/WeGame/Setup/WeGameSetup.exe'
HTTP/1.1 404 Not Found
```

顺手试了 10+ 个常见路径变体（`wegame/wegame_setup.exe`、`tgp/Client/*`、`wegame_p2p/*`、大小写变体、`v6` 子域、`down.qq.com/*` 等）**全部 404**。再往上溯：
- 腾讯软件中心 `pc.qq.com/detail/1/detail_23761.html` 的"立即下载"按钮走的是**腾讯电脑管家存根** `QQPCDownload320073.exe`（2.57 MB），运行时再由存根去后端拉真实 WeGame —— 这套在 Linux/Wine 里走不通
- `wegame.com.cn` 首页是 SPA，按钮背后也没暴露静态 URL
- 第三方下载站普遍只托管的还是上面那个存根（改名为"WeGame.rar"）

**结论**：腾讯已经**不再对公众提供 WeGame 客户端的稳定公网静态直链**，任何硬编码 URL 都会失效；第三方镜像又有版权风险，不应内置。

### 变更概览

本次改动**不升 MINOR**，作为 PATCH 紧急修复发布。采纳 A+C 方案：「本地文件优先 + 在线下载兜底（实验性）」。

**后端** `electron/backend/wegame_installer.ts`
- 废弃 `DEFAULT_WEGAME_INSTALLER_URL` 单值常量，改为 `DEFAULT_WEGAME_INSTALLER_URL_CANDIDATES` **有序候选列表**（当前 3 条历史 URL，全部 404——保留作腾讯日后恢复的哨兵）
- 新增 `resolveDownloadUrlCandidates()`：用户 `extra_env_vars.WEGAME_INSTALLER_URL` 排最前（可指向企业内网/自维护镜像），后面跟内置候选，保序去重
- `InstallerInfo` 类型更新：`defaultDownloadUrl: string` → `downloadUrlCandidates: string[]` + `officialDownloadPage: string`
- 新增 `probeUrl()`：HEAD 探测，10s 超时，要求 HTTP 200 + `Content-Length > 1 MB`。只花一次 HEAD 就能跳过死链，不会触发完整下载
- `downloadWegameInstaller()` 重写为"按序探测 → 首个可用源下载"逻辑：每个候选源 HEAD 失败即记录后继续；全部失败时返回 `all-sources-unavailable` 明确错误 + 官网 URL，让前端兜底到本地文件
- 新增 `installWegameFromLocalFile()`：用户选中的 `.exe` 必须存在、是文件、≥ 1 MB、以 `.exe` 结尾；通过后复制到缓存目录（`~/.cache/decky-wegame/installers/WeGameSetup.exe`）以便后续重装免重选，最后走和在线路径共用的 `runWegameInstaller()`

**IPC** `electron/ipc.ts`
- 新增 `import { dialog } from "electron"`
- 新增 `pick_wegame_installer`：`dialog.showOpenDialog` 原生文件选择器，过滤 `*.exe`，返回 `{ canceled, filePath }`
- 新增 `install_wegame_from_local(config, localPath)`：运行用户本地安装器，复用既有的 `wegame-install-progress` 事件通道

**前端 API** `src/utils/api.ts`
- 暴露 `pickWegameInstaller()` 与 `installWegameFromLocal(config, localPath)`

**UI** `src/components/config/WeGameInstaller.tsx`
- 新 handler：`handleInstallFromLocal()`（选文件 → 直接开装）、`openOfficialPage()`（`window.open("https://www.wegame.com.cn/")` 在系统浏览器打开）
- `wizard` 与 `manage` 两种 `variant` 下均提供**三路入口**的统一布局：
  - 主推（`neon-primary`）「选择本地安装器文件」
  - 次级（`neon-secondary`）「打开官网」
  - 粘底（muted 边框）「在线下载（实验）」—— 按钮 title 明确说明可能失败
- 错误面板改造：**首先**引导用户去本地文件路径，而非单纯的"重试"，符合当前客观现实
- `installed === true` 分支同样给出两个重装选项：「用本地文件重装」与「在线重新下载（实验）」

### 关键技术决策
- **不内置第三方镜像 URL**：哪怕第三方有现成的 `wegame_setup.exe` 下载源，镜像分发腾讯二进制有版权风险。规范做法是让用户自己从 `wegame.com.cn` 取一份；用户若有企业自维护镜像可通过 `extra_env_vars.WEGAME_INSTALLER_URL` 注入
- **HEAD 探测而非 GET 前几个字节**：省流量也更快能识别"死链家族"
- **本地文件复制到缓存**：一次性开销，换来"以后重装无需再 browse"的体验；如果 copy 失败（只读媒介、权限问题）降级为直接从原路径 spawn，保证主流程不中断
- **保留"在线下载"作实验性兜底而不是删掉**：腾讯未来可能恢复某个路径，届时用户自发点它就能用；同时 `extra_env_vars.WEGAME_INSTALLER_URL` 的自定义 URL 也复用这条路径
- **不改 `install_wegame` IPC 契约**：上层向导代码无需改动；wizard step 5 的组件级集成在 v1.8.0 已经完成，本次只是给组件加两个按钮

### 不做的事
- 不修改 `launch_wegame_cmd` 的错误横幅「打开配置向导」按钮 —— 那条路径现在仍然会让用户回到 step 5，只不过 step 5 的 UI 已经变了
- 不改 `checkWegameStatus` 的探测逻辑 —— WeGameLauncher.exe 仍然是同一个文件
- 不在本次里做"安装器版本校验"（checksum / 签名）—— 目前 Wine 会拒绝跑损坏的 PE，用户能立刻感知

### 关键文件
- 修改：`electron/backend/wegame_installer.ts`（+312 / -50）、`electron/ipc.ts`（+35）、`src/utils/api.ts`（+8）、`src/components/config/WeGameInstaller.tsx`（+196 / -40）
- 同步：`package.json` v1.8.0 → v1.8.1、`README.md`（顶部版本号 + 功能特性 WeGame 本体管理段 + 使用说明 step 5）、`PRD.md`（顶部元信息 + §4.1 Step 5 UI/流程/IPC 表 + §4.2.6 `<WeGameInstaller>` IPC 行 + Changelog v1.8.1 条目）、`DEVLOG.md`（本条目）

## 2026-04-18 — 文档治理：明确 README / PRD / DEVLOG 三者职责，收敛到 Agent 规则文件

### 背景
随着版本迭代，三份 Markdown 文档出现了定位交叉：
- **README.md** 里开始夹带大量 `（v1.8 重构）` / `（v1.8.1 调整）` 之类的版本沿革标签，让首次接触软件的用户在"了解软件能做什么"时被迫穿越多个版本的历史叙述；
- **PRD.md** 里同样充满版本标签，且维护着一份与 DEVLOG 重复的 Changelog（§九），加上附录里保留的 `v1.1 修复详情` 等早已不具备"需求定义"价值的段落；
- **DEVLOG.md** 早期条目（2026-04-16 ～ 2026-04-17）写成了每次 refactor、每次 typo 级别的流水账，新维护者读到这些条目时要花大量精力才能找到真正的"关键改动"。

三者边界模糊带来的直接后果：**对用户友好**、**对开发者有用**、**长期可追溯**这三件事都没做好，且文档互相引用导致一处改动要同步改三份。

### 变更概览

**扩充项目内已有的 Agent 规则文件 `.codebuddy/rules/devoloper.md`**（原先只覆盖需求 / Git / DEVLOG / 版本同步四类规则），新增 **§0 三份核心文档的定位与边界** 小节，明确带出：
- 用一张表把 README / PRD / DEVLOG 的读者 / 定位 / 内容要求讲清楚：README 面向用户 + 禁版本沿革标签；PRD 面向开发者 + 禁 Changelog；DEVLOG 长期存档 + 禁流水账。
- 为每份文档单独列出"允许 / 禁止"条目和写作视角。
- 同时在 §3.1 DEVLOG 记录时机补充"不要记录流水账"的明文约束。
- **不另建新的根目录 RULES 文件**：该规则只给 Agent 读，适合放在 `.codebuddy/` 目录下（已被 `.gitignore` 忽略，不影响对外仓库外观）；避免规则双头维护。

**精简 `README.md`**：剔除 9+ 处 `（vX.Y 调整/新增/修正）` 版本标签；合并两条重复的"WeGame 本体管理"条目为一条；使用说明里"腾讯已不再提供稳定直链"这类历史叙述改为中性表述；顶部只保留一条指向 PRD 与 DEVLOG 的链接。

**精简 `PRD.md`**：
- 顶部元信息改为 `当前版本 + 最后更新` 两行，不再夹带版本号到日期里；新增"文档约束"说明 PRD 只描述当前版本。
- 清理正文中 15+ 处版本沿革标签（`（v1.4 重要调整）` / `（v1.7 调整）` / `（v1.7 新增）` / `（v1.7.1 新增）` / `（v1.8.1 调整）` / `（v1.8.1 修正）` 等），章节标题一律去掉括号内的 vX.Y。
- **整段删除** §九「变更记录 (Changelog)」及尾部「v1.1 修复详情」附录——历史现在只在 DEVLOG 里活着。
- §七「开发流程规则」精简为一段自述（PRD 为需求唯一来源、疑问先确认、不保留版本沿革），另注明其余协作规则在项目内部 Agent 规则文件维护，避免规则双头维护。
- 文件体积从 42.97 KB → ~35.8 KB。

**精简 `DEVLOG.md`**：把最早 7 条琐碎条目（"核心功能架构"/"技术优化"/"安装向导问题修复"/"密码验证问题修复" + 3 条"需求调整"）折叠成一条 `2026-04-16 ～ 2026-04-17 — 项目初始化与技术栈确立`，只保留真正关键的 Tauri → Electron 架构决策叙事；其他琐碎修正显式交给 `git log`。同时把 v1.3 / v1.3 补强 / v1.4 三条条目的标题补齐版本号标签，与后续 v1.5 ～ v1.8.1 风格一致。顶部新增"编写约束"提示。

### 关键决策
- **规则沉到已有的 Agent 规则文件而非新建根目录 `RULES.md`**：该规则只给 AI / 开发者读，不是面向终端用户的产品文档。`.codebuddy/rules/devoloper.md` 已由环境自动加载为规则上下文，再新建一份同名文件只会导致规则垂直双头维护。
- **不升版本号**：本次改动不新增/删除/重命名用户可感知功能、不改默认行为、不改 IPC 接口，属于纯文档治理，不触发 `package.json` 升版本。
- **不删除已存在的 DEVLOG 历史条目**：只合并早期流水账，保留 v1.2 及以后所有带完整技术决策的条目——因为它们对"半年后还原来龙去脉"确实有帮助。
- **PRD 尾部保留一小节"附：变更历史"指针**：即使 PRD 不再维护 Changelog，读者在 PRD 末尾仍能一眼看到"变更历史去哪里查"，降低信息断裂感。

### 关键文件
- 修改：`.codebuddy/rules/devoloper.md`（新增 §0 三份文档定位与边界、§3.1 补写"不写流水账"）、`README.md`（剔除版本沿革标签、合并重复条目）、`PRD.md`（剔除版本沿革标签、删除 §九 Changelog、删除 v1.1 修复详情附录、§七 精简为自述）、`DEVLOG.md`（折叠早期 7 条流水账、统一版本号标签样式、顶部补写作约束）




