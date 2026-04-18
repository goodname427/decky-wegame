# WeGame Launcher 产品需求文档 (PRD)

> 本文件是 **WeGame Launcher** 项目的唯一产品需求来源。所有新增需求、需求调整、bug 反馈都必须同步更新到本文件。
> 后续开发必须**严格遵守**本文件中的要求。如遇未覆盖的细节，应先向产品负责人询问确认，再补充到本文件中。

- **项目名称**：WeGame Launcher（decky-wegame）
- **目标平台**：SteamOS / Steam Deck（Linux）
- **目标用户**：希望在 Steam Deck 上运行腾讯 WeGame 平台及其游戏的玩家
- **最后更新**：2026-04-18（v1.8.0）

---

## 一、产品定位

一款运行在 SteamOS / Steam Deck 上的**独立桌面应用**，用于在 Linux 环境下一站式**配置、启动、管理**腾讯 WeGame 游戏平台，屏蔽 Wine/Proton 相关的复杂配置细节。

---

## 二、技术栈（已定型）

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + TailwindCSS |
| 桌面框架 | Electron（自带 Chromium，避开 WebKitGTK/EGL 兼容性问题） |
| 后端逻辑 | Node.js + TypeScript（通过 IPC 与前端通信） |
| 构建工具 | Vite 5 + electron-builder |
| CI/CD | GitHub Actions（输出 AppImage + deb，Ubuntu 22.04 构建） |

> **重要技术决策**：已从 Tauri 迁移到 Electron，不再支持 Tauri。

---

## 三、整体信息架构

### 3.1 顶层页签（共 4 个）

1. **控制台 / Dashboard**
2. **启动器 / Launcher**
3. **设置 / Settings**
4. **关于帮助 / About**

### 3.2 环境设置向导（Modal）

- 首次打开应用时**自动弹出**
- 可在「设置」页点击「重新配置环境」按钮手动打开
- 以 Modal 弹窗形式呈现（非常驻页签）

---

## 四、功能模块详细需求

### 4.1 环境设置向导（SetupWizard）

向导共 **5 个步骤**，每步独立切换，支持「上一步」「下一步」「跳过向导」。

#### 步骤 1：确认中间层
- **检测对象**：Wine、winetricks、Proton 兼容层
- **功能整合**：将原步骤1（环境检查）和步骤2（选择Proton）合并，统一检测中间层环境
- **交互流程**：
  1. 打开向导后自动扫描所有中间层组件
  2. **扫描到依赖**：显示扫描到的多个路径列表，默认选中第一个；用户可选择其他路径；额外提供两个选项：「自定义路径」「直接下载」
  3. **未扫描到依赖**：提示用户未扫描到，仅显示「自定义路径」「直接下载」两个选项
- **路径展示**：每个路径附带**版本号**和**来源标签**（如 PATH、Proton 内置、Flatpak 等）
- **自定义路径**：手动输入路径后由后端验证（文件存在性、可执行权限、`--version` 运行验证）
- **下载安装**：展示下载/安装命令和外部跳转链接
- **约束**：所有中间层组件必须解决（选中或填写有效路径）后才能进入下一步；提供「重新检测」按钮

#### 步骤 2：确认依赖

**设计哲学（v1.4 重要调整）**：采纳「依赖最小化」策略 —— **先让 WeGame 跑起来，缺什么再补什么**，而不是一次性预装一堆可能用不到的 Windows 依赖。

**核心事实**：
- WeGame 客户端主体是 C++ / Qt，**并非 .NET 应用**，自身并不强依赖 .NET Framework 运行。
- 我们默认选用的 **Proton-GE-Custom 已内置** DirectX 9/11、VC++ 2005-2022 Runtime、corefonts 等大部分常用 Windows 依赖，**无需重复安装**。
- `.NET Framework 4.x` 在 Wine/Proton 下是知名的不稳定组件（已知的 64bit prefix 问题 + 微软源证书问题），**能不装就不装**。

**依赖分层（UI 上明确区分）**：

| 分组 | 项目 | 默认状态 | 说明 |
|------|------|---------|------|
| **按需** | `corefonts` | ⬜ 默认不勾 | Proton-GE 已内置；仅当 WeGame 英文界面出现字体异常时再装 |
| **按需** | `font-cjk` / `cjkfonts` | ⬜ 默认不勾 | Proton-GE 通常已能正常显示中文；仅在出现方块 / 乱码时再装（新版 winetricks 在未初始化 prefix 上易跳 c0000135） |
| **按需** | `riched20` / `riched30` | ⬜ 默认不勾 | 富文本控件，登录页/聊天页若异常时再补 |
| **按需** | `dotnet46` / `dotnet48` | ⬜ 默认不勾 | **仅当 WeGame 提示缺 .NET 或具体子功能报错时**再勾选安装 |
| **按需** | `vcrun*` | ⬜ 默认不勾 | Proton-GE 已自带，一般无需单独安装 |
| **按需** | `directx9` (`d3dx9`) | ⬜ 默认不勾 | Proton-GE 已自带 |
| **按需** | `ie8` / `mscoree` / `gdiplus` | ⬜ 默认不勾 | 仅在特定报错时补装 |

> **v1.7 调整**：取消了原来 `corefonts` / `cjkfonts` 的「推荐默认勾选」状态。现实日志表明：在 Steam Deck
> 的新建 prefix + GE-Proton7-20 环境下，winetricks 新版安装字体时会因 `syswow64\regedit.exe` 未初始化而跳
> `c0000135 (DLL_NOT_FOUND)`，并且 Proton-GE 本身已能正常渲染中文，**默认装这两个字体弊大于利**。

**UI 要求**：
- 页面顶部明显展示一条提示条：「🎯 推荐策略：先尝试直接运行 WeGame，遇到具体报错再来此处补装对应依赖」
- 提供「**一键全选（完整安装）**」按钮（老派用户兑底）
- 提供「**恢复推荐**」按钮：v1.7 起此按钮会取消全部勾选（由于已取消推荐分组），鼓励用户进入第 5 步先试运行 WeGame
- 每个依赖项点击可展开**详细说明**（解决什么问题、失败常见原因）
**跳过依赖安装**：允许用户在步骤 2 直接"跳过依赖安装"进入步骤 3，**不再强制要求装依赖**。

#### 步骤 3：路径选择
- **功能优化**：专注于配置下载内容的保存路径
- **配置内容**：
  - 中间层安装路径（Wine、Proton等）
  - 依赖组件缓存路径
  - 临时下载目录
- **约束**：所有路径必须配置完成后才能进入下一步

#### 步骤 4：执行安装
- 点击「开始安装」后：
  1. 保存环境配置
  2. 初始化 Wine Prefix
  3. **基础初始化兜底（v1.7 新增）**：检测 `<prefix>/drive_c/windows/syswow64/regedit.exe` 是否存在；
     不存在则自动调用 `wine64 wineboot --init`，避免后续 winetricks 安装字体/依赖时挖到
     `c0000135 (DLL_NOT_FOUND)` 坑（实际日志表明：新建 prefix + GE-Proton7-20 新版 winetricks 必踩）。
  4. 检测 winetricks 是否可用：
     - 不可用 → **弹出密码输入弹窗**（见 4.1.1）
     - 可用 → 直接开始依赖安装
- 安装过程展示进度条、当前步骤、完成步骤数
- 安装完成后，向导**自动推进到步骤 5**（如用户已使用「跳过向导」全局跳过则不推进）。
- **0 依赖分支（v1.7.1 新增）**：若用户在步骤 2 没有勾选任何依赖（v1.7 默认状态），步骤 4 标题显示「准备完成环境配置」，按钮文案切换为「创建环境并继续」；后端路由到 `skip_dependency_installation` 仅做 prefix 初始化，**跳过 winetricks 与 sudo 密码弹窗**，随后依靠相同的 `status: "completed"` 事件推进至步骤 5。

#### 步骤 5：安装 WeGame（v1.7 新增）

**背景**：v1.6 之前向导完成后，WeGame 本体仍然不存在于 prefix 中，用户点「启动」必失败（`WeGame executable not
found`）且没有任何引导。v1.7 将「安装 WeGame 本体」作为向导的必要收尾步骤。

- **自动检测**：进入该步后立即调用 `check_wegame_installed`、搜索以下路径：
  - `<prefix>/drive_c/Program Files/Tencent/WeGame/WeGameLauncher.exe`
  - `<prefix>/drive_c/Program Files (x86)/Tencent/WeGame/WeGameLauncher.exe`
  - `<prefix>/drive_c/Program Files/Tencent/WeGame/WeGame.exe`
  - 用户自定义的 `wegame_install_path`
- **已安装**：展示绿色「已安装」卡片 + 完整可执行文件路径；提供「重新下载并安装」按钮（用于覆盖安装或升级）。
- **未安装**：展示黄色提示卡 + 「下载并安装 WeGame」主按钮。
- **安装流程**：点击主按钮后调用 `install_wegame`，后端会：
  1. 如本地缓存（`~/.cache/decky-wegame/installers/WeGameSetup.exe`）不存在或不完整，从腾讯官方
     `https://dldir1.qq.com/WeGame/Setup/WeGameSetup.exe` 下载，进度映射到 0～95%。支持用户通过
     `extra_env_vars.WEGAME_INSTALLER_URL` 自定义官方楕代源。
  2. 调用 `resolveWineBackendEnv()`、再运行 `ensureWinePrefixInitialized()`、最后 `spawn(wine64, "WeGameSetup.exe")`。
  3. 安装器 GUI 弹出后以 5 秒一次的心跳推进条（上限 80%），状态文案提示「请在安装向导里完成所有步骤」。
  4. 安装器进程退出后，再次调用 `isWegameInstalled`；找到可执行文件则进度 100% 并标记成功；未找到则判为失败，
     给出「您可能在向导里取消了安装，请重试」或「退出码异常 + 请查看日志」提示。
- **失败恢复**：错误卡提供「重试」、「清缓存并重新下载」两个动作。
- **日志**：使用独立的 `installerLogger`（输出到 `logs/installer_*.log`），方便与依赖安装日志区别。
- **跳过**：任何时候点右下角「稍后安装并完成」或「完成」都允许结束向导，仅在 `wegameInstalled===true` 时按钮文案为「完成」。

**IPC 接口**（已暴露给前端 `src/utils/api.ts`）：

| IPC 名 | 说明 |
|--------|------|
| `get_wegame_installer_info` | 返回缓存路径/是否已缓存/大小/默认下载 URL |
| `check_wegame_installed` | 检查 prefix 中是否已有 WeGameLauncher.exe |
| `download_wegame_installer` | 仅下载安装器，不运行 |
| `run_wegame_installer` | 运行指定路径的安装器（支持用户选本地文件） |
| `install_wegame` | 一键「下载 + 安装」（此章节向导使用的入口） |
| `clear_wegame_installer_cache` | 清理本地安装器缓存 |

所有进度通过 `wegame-install-progress` 事件广播，结构：

```ts
{
  phase: "download" | "install" | "done" | "error";
  percent: number;        // 0-100
  message?: string;       // 用户可见的状态文案
  error?: string;         // 仅在 phase="error" 时有值
}
```

#### 4.1.1 密码输入弹窗（sudo 权限获取）
- **触发条件**：安装 winetricks 时需要 sudo 权限
- **UI 要求**：
  - 标题：「需要管理员权限」
  - 说明：安装 winetricks 需要管理员权限，请输入密码继续
  - 输入框：type=password，autoFocus
  - 按钮：「取消」「确认」
  - 错误提示：输入为空显示「请输入密码」；密码错误显示「密码错误，请重新输入」并重新弹出
- **后端行为**：通过 `echo "$password" | sudo -S` 方式传递密码

### 4.1.2 跳过功能（Skipping）

提供全局跳过功能：

1. **全局跳过**（跳过整个向导）
   - 位置：向导底部导航栏的「跳过向导」按钮，**任何步骤都可用**
   - 行为：弹出确认对话框，确认后跳过整个安装向导，使用默认配置，关闭向导
   - 说明文案：「这将跳过整个安装向导，包括环境配置、Proton 选择、依赖安装等所有步骤。系统将使用默认配置，但可能影响 WeGame 的正常运行」

> ⚠️ 重要：跳过功能**只在安装向导中提供**，不在「依赖管理」页面提供（避免功能重复）。
---

### 4.2 依赖管理（Dependencies 页面）

**定位**：承担日常环境维护所需的全部能力，是"设置"下的核心子页签。

#### 4.2.1 顶部工具栏
自上而下的操作入口集中摆放在页面顶部，按重要性排序：

1. **重新配置环境**（主按钮）
   - 图标：`Wand2` / `Settings`，风格 `neon-primary`
   - 点击后重新打开「环境设置向导」Modal
   - 说明副标题：用于重新走一遍完整的配置流程
2. **安装缺失项**（次按钮，保留）
3. **全部重装**（次按钮，保留）

#### 4.2.2 Winetricks 依赖列表
（原有能力，v1.4 调整：依赖列表按"推荐 / 按需"分组，默认勾选策略遵循 §4.1 步骤2 的依赖分层表）

- 列出所有 winetricks 依赖及其安装状态（已安装 / 未安装）
- **分组展示**：
  1. **推荐**（corefonts、cjkfonts）—— 顶部高亮
  2. **Wine 扩展**（riched、gdiplus、ie8、mscoree 等）
  3. **.NET Framework**（dotnet46、dotnet48，附警告标签"在 64bit prefix 下可能不稳定"）
  4. **C++ 运行时**（vcrun 系列，附提示"Proton-GE 已自带，一般无需安装"）
  5. **图形/多媒体**（d3dx9、directx9 等，附提示"Proton-GE 已自带"）
- 支持「安装缺失项（仅推荐）」、「安装缺失项（全部）」、「全部重装」
- **不包含跳过安装功能**（跳过功能只在向导中）
- **状态检测**：通过 `checkInstalledWinetricks()` 查询 wine prefix 下已安装的包；安装完成后自动刷新。

#### 4.2.2.1 依赖安装后端（Wine 后端注入，重要）

- **后端选择策略**：依赖安装时，**始终使用当前用户选定的 Proton（`config.proton_path`）内置的 wine / wineserver 作为后端**。
  - 原因 1：SteamOS / Steam Deck 系统默认不提供独立 `wine` / `wineserver`，系统 PATH 里找不到。
  - 原因 2：让依赖安装使用的 wine 版本与启动 WeGame 时使用的 wine 版本保持一致，避免 prefix 状态错乱（如依赖装在 wine-7，游戏跑在 wine-9）。
- **Proton wine 目录解析规则**（按顺序尝试，取第一个存在的）：
  1. `<ProtonDir>/files/bin`（GE-Proton / 新版 Proton 官方版）
  2. `<ProtonDir>/dist/bin`（旧版 Proton 官方版）
  - `<ProtonDir>` = `dirname(config.proton_path)`
- **注入到 winetricks 子进程的环境变量**：
  - `PATH = <ProtonBin>:$PATH`
  - `WINE = <ProtonBin>/wine64`（若不存在则 `wine`）
  - `WINESERVER = <ProtonBin>/wineserver`
  - `WINELOADER = <ProtonBin>/wine`
  - `WINEDLLPATH = <ProtonDir>/files/lib64/wine:<ProtonDir>/files/lib/wine`（存在则加）
  - `WINEPREFIX = config.wine_prefix_path`
  - `WINEARCH = win64`
  - `DISPLAY = :0`
- **失败处理**：若未选中 Proton 或解析不到 `<ProtonBin>/wineserver`，**立刻终止安装流程**并向前端上报清晰错误（如 "未找到可用的 Wine 后端：请先在『配置向导』或『依赖管理』中选定一个 Proton 版本"），**不得**继续逐项调用 winetricks 以制造假进度。
- **`checkInstalledWinetricks`** 在查询 wine prefix 已安装包时使用相同的 env 注入规则。

#### 4.2.2.2 下载镜像源策略（v1.4 新增）

winetricks 默认从微软/Google/Web Archive 等境外源下载依赖包，在 Steam Deck（国内）下常因 **SSL 证书不被信任**、**DNS 污染**、**IPv6 不可达** 等原因失败（参见实际日志：`dotnet46` 下载微软源时提示"证书颁发者未知"，备用源 `web.archive.org` IPv6 "网络不可达"）。

**策略（按优先级降级）**：

1. **预置文件匹配**（Priority 1）
   - 应用打包时内置一份 `mirror-manifest.json`，记录常见依赖（dotnet46/48、vcrun、d3dx9 等）的：`verb id + 预期文件名 + 预期 sha256 + 国内镜像 URL 列表`
   - 依赖安装前，**应用层**直接把镜像文件下载到 winetricks 缓存目录 `~/.cache/winetricks/<verb>/<filename>`，校验 sha256 通过后让 winetricks 跳过下载步骤
   - 优先级：国内公开镜像 > GitHub Release 兜底

2. **国内公开镜像源**（Priority 2）
   - 候选镜像源列表（需实现时逐一验证可达性）：
     - 腾讯软件源 `https://mirrors.cloud.tencent.com/`
     - 清华大学 TUNA `https://mirrors.tuna.tsinghua.edu.cn/`
     - 中科大 USTC `https://mirrors.ustc.edu.cn/`
     - 华为云 `https://mirrors.huaweicloud.com/`
   - 对每个依赖维护**多源列表**，前一个失败自动尝试下一个

3. **GitHub Release 兜底**（Priority 3）
   - 在本项目 GitHub Release 上传一次性的依赖包 Assets（命名规则：`deps-<verb>-<version>.exe`）
   - 通过 `ghproxy`（如 `https://ghgo.xyz/` / `https://mirror.ghproxy.com/`）反代加速国内访问
   - 仅用于公开镜像都失败时兜底

4. **直接调用 winetricks**（Priority 4）
   - 前 3 步都失败 → 原生 winetricks 自己去下（可能失败，失败后 UI 明确提示"镜像源全部不可达，请检查网络或使用代理"）

**实现要求**：
- **不得**要求用户自行搭建或提供镜像源
- 镜像源配置集中在 `electron/backend/mirrors.ts`，方便后续维护
- 日志中清晰记录每一步尝试的来源、耗时、命中/失败
- 提供**手动重试**按钮：失败后可选择"换一个源重试"

#### 4.2.2.3 依赖状态缓存与异步刷新（v1.5 新增）

**背景**：用户实测每次进入「设置 → 依赖管理」页面都会卡顿 2~5 秒才能操作。根因是挂载时 IPC 调用 `get_dependency_list`，后端同步执行 `winetricks list-installed`（内部触发 `wineserver` 冷启动 + 注册表读取），在此期间 Electron 主进程的 IPC 队列被 `execSync` 阻塞，全部 UI 操作无响应。

**策略**：

1. **后端内存缓存**
   - 以 `WINEPREFIX` 路径作为缓存 key，缓存最近一次 `winetricks list-installed` 的结果（`Set<string>`）与时间戳
   - 缓存命中时立即返回，不启动 winetricks 子进程
   - 缓存默认**长期有效**（只在显式事件时失效），不使用基于时间的 TTL（避免不必要的 winetricks 调用）

2. **自动失效时机**（覆盖所有状态会真实变化的路径）：
   - 依赖安装流程结束（成功 / 部分成功 / 全部失败）时 invalidate
   - 重置 Wine Prefix 后 invalidate
   - 用户点击「刷新」按钮时 invalidate 并强制重新查询
   - 切换 `wine_prefix_path`（prefix 路径变更 → 缓存 key 天然不同）自动失效

3. **前端异步 + 立即可交互**
   - 进入依赖管理页面时，**立即**用 `DEPENDENCY_LIST` 的默认数据渲染（`installed: false` 占位），用户可以立刻操作
   - 同时后台发起 `get_dependency_list` 调用，返回后平滑更新"已安装"标记
   - 查询进行中在工具栏显示轻量的「正在刷新状态…」提示（不阻塞任何按钮）

4. **手动刷新入口**
   - 依赖管理页工具栏新增「刷新状态」按钮（图标 `RefreshCw`，区别于「全部重装」），点击触发强制刷新（绕过缓存）
   - 刷新按钮在进行中变 `animate-spin`，结束后恢复

5. **后端实现约束**
   - `checkInstalledWinetricks` 保持现有 `execSync` 实现作为底层能力，但**不在 IPC handler 中同步调用**
   - 新增异步版本 `checkInstalledWinetricksAsync`：使用 `spawn` + Promise 包装，不阻塞主进程事件循环
   - IPC handler `get_dependency_list` 改为 `async` + `await`，内部走异步路径 + 缓存
   - 新增 IPC `refresh_dependency_list`：强制 invalidate 并重新查询
   - 依赖安装结束的 emit 阶段在后端自动 invalidate，**无需前端显式调用**

**验收标准**：
- 冷启动第一次进入依赖管理页：<200ms 可交互（列表先显示占位，"已安装"状态稍后到）
- 之后每次进入：<50ms 可交互（缓存命中，几乎瞬时显示正确的"已安装"状态）
- 任何时刻其他 IPC 调用（Proton 扫描、配置保存、诊断等）都不会被依赖查询阻塞

#### 4.2.3 中间层管理（新增区块）

针对 Wine、winetricks、Proton 三类中间层，统一入口进行管理：

- **查看当前状态**
  - 显示当前选中 / 正在使用的 Wine、winetricks、Proton 版本与路径
- **查看所有扫描到的版本**
  - 通过 `scan_system_dependencies` + `get_proton_versions` 聚合展示
  - 每个版本显示：名称、版本号、来源标签（PATH / Proton 内置 / Flatpak / 用户目录 / 自定义路径等）
- **切换当前版本**
  - 对 Proton：点击任一版本可切换 `config.proton_path`
  - 对 Wine / winetricks：当前由系统 PATH 决定，UI 只做展示，不强制切换
- **自定义路径**
  - 每类中间层提供「自定义路径」输入框，用户填写后由后端 `validate_dependency_path` / `validate_proton_path_cmd` 校验
  - 校验通过后保存到 `EnvironmentConfig` 中（Proton 存 `proton_path`；Wine/winetricks 作为扩展字段存在 `extra_env_vars` 的 `CUSTOM_WINE_PATH` / `CUSTOM_WINETRICKS_PATH` 下，或者新增独立字段，由实现阶段决定）
- **删除已安装版本**
  - **只允许删除位于用户目录下的 Proton 版本**（`~/.steam/root/compatibilitytools.d/` 和 `~/.local/share/Steam/compatibilitytools.d/`）
  - 删除前弹出 `ConfirmDialog` 二次确认
  - 系统级 Wine / winetricks **不提供删除**（避免误删系统组件）
- **下载安装新版本**
  - Proton（GE-Proton）：支持**一键下载安装**到 `~/.steam/root/compatibilitytools.d/`（后台 tar 解压）；下载过程显示进度条
  - Wine：展示推荐的系统包管理器命令，并可弹出**密码输入弹窗**执行 `sudo pacman -Sy wine`（SteamOS 下自动处理 `steamos-readonly`）
  - winetricks：同上；或提供"下载脚本到 `~/.local/bin/`"的免 sudo 方案（推荐）
  - 下载完成后自动刷新扫描结果

#### 4.2.4 自定义安装路径（新增区块，从基础设置迁移而来）

- **Wine 前缀路径**（`wine_prefix_path`）
- **WeGame 安装路径**（`wegame_install_path`）
- 立即生效（输入框失焦或修改防抖 500ms 后自动保存）
- 路径修改属于"重要操作"，如果修改了已存在的 prefix 路径，弹出提示："修改后旧目录不会自动迁移，请确认已备份/复制"

#### 4.2.5 重置 Wine Prefix（新增，从基础设置迁移而来）

- 放在依赖管理页签底部"危险操作区"
- 功能与原先一致，需 `ConfirmDialog` 二次确认

#### 4.2.6 配置一致性（v1.8 新增）

**背景**：v1.7 之前「安装向导」与「依赖管理页」各自实现了一份"路径编辑 / Proton 选择 / WeGame 安装"UI，长期下来出现了**能力/行为割裂**——例如向导里没有"下载最新 GE-Proton"按钮、没有"winetricks 一键到 ~/.local/bin"按钮、Step 3 的字段 label 与实际字段不符（`wegame_install_path` 被错误地标为"依赖缓存路径"）。

**约束**：两者本质上是**同一套配置**的两种呈现（首次引导 vs. 日常维护），必须保证**功能对等、行为一致**。

**实现方式**：抽出 `src/components/config/` 下 3 个共享组件，统一作为「唯一事实来源」；SetupWizard 与 Dependencies 页面以 `variant` 属性选择呈现形态。

| 组件 | 职责 | `variant` 值 | 前端事件/IPC |
|---|---|---|---|
| `<PathsSection>` | 编辑 `wine_prefix_path` + `wegame_install_path` | `wizard` / `panel` | `save_config_cmd`（变量后防抖保存；wizard 模式通过 `onLocalChange` 回传暂存） |
| `<ProtonPicker>` | 列出 Proton / 切换 / 下载 GE-Proton / 删除用户持有版本 | `wizard` / `panel` | `get_proton_versions` / `download_ge_proton` / `delete_proton_version` + `middleware-download-progress` 事件 |
| `<WeGameInstaller>` | 检测 / 下载 / 运行 / 重装 WeGame，支持状态回传 | `wizard` / `manage` | `check_wegame_installed` / `install_wegame` / `clear_wegame_installer_cache` + `wegame-install-progress` 事件 + `onStatusChange` 回调 |

**向导侧补齐能力**：
- Step 1 Proton 区块：用 `<ProtonPicker variant="wizard">`，附带"下载最新 GE-Proton"按钮（**向导中也可一键获取**，不再需要跳回依赖管理页）
- Step 1 winetricks 缺失 → 选"下载安装"分支时，追加"立即下载到 `~/.local/bin`（无需密码）"按钮，成功后自动重新扫描
- Step 3 路径字段：统一由 `<PathsSection variant="wizard">` 提供（同时修正原 label 错位 bug）
- Step 5 WeGame 安装：整块替换为 `<WeGameInstaller variant="wizard">`；向导只保留 `wegameInstalled` 一个轻量状态用于"完成 / 稍后安装并完成"按钮文案判断，进度/重试/错误处理一律由共享组件负责

**依赖管理页侧补齐能力**：
- 顶部工具栏保留不变
- 新增 `<WeGameInstaller variant="manage">` 卡片：展示 WeGame 安装状态，支持「下载并安装」/「重新安装（清缓存）」/「重试」
- 依赖项 hover 时多出"重装"迷你按钮：调用 `start_install_dependencies` 并传 `selectedIds: [dep.id]`，支持单项重装而不必"全部重装"

**约束（写入 §5 禁止事项）**：
- 任何关于 Wine Prefix / WeGame 安装路径 / Proton 选择 / WeGame 本体安装的 UI，**必须**通过 `src/components/config/` 下的共享组件实现，**禁止**在向导或管理页中复制粘贴一份重复实现
- 新增可配置字段时，先在共享组件中加入；两个入口点自动同步，无需手工双写

---

### 4.3 启动器（Launcher 页面）

- 一键启动/停止 WeGame
- 配置完整的环境变量（Proton 路径、Wine Prefix 等）
- 扫描已安装的游戏
- 支持将游戏添加到 Steam 库

#### 4.3.1 错误反馈与启动探测（v1.6 新增）

背景：先前"启动 WeGame"失败时前端只 `console.error`，用户看到的是"点了没反应"，且无法判断日志位置。必须让所有异步操作在界面上给出明确反馈。

- **启动中状态**
  - 点击"启动 WeGame"后，按钮立即进入 `disabled + loading` 状态（旋转图标 + "启动中…"文案），避免用户连点
  - 按钮禁用直到后端 IPC 返回或超时
- **即时错误反馈**
  - IPC 抛出的任何错误（如 `No Proton version found` / `WeGame executable not found` / spawn 失败）必须以**页面顶部红色横幅**（dismissable）形式展示 `err.message` 全文
  - 横幅下方附一行灰色小字："详细日志：`~/.local/share/decky-wegame/logs/launcher.log`"
  - 横幅保留直到用户关闭或下一次成功操作
- **启动后探测**
  - 启动命令返回后，等待 3 秒再 `refetch` WeGame 状态
  - 若此时 `status.running === false`（进程秒退），展示**黄色警示横幅**："WeGame 进程已启动但随即退出，可能是 prefix 损坏或依赖缺失。查看 `launcher.log` 中 `[stderr]` 与 `exited with code` 附近内容定位原因"
  - 若 `status.running === true`，清除任何现存横幅
- **停止按钮**
  - 同样需要 loading 状态 + 错误横幅
- **复用范围**
  - Dashboard 页面上的"启动 WeGame"快捷入口必须遵循相同反馈规范

**验收标准**：
- 随便点一次启动按钮，都能在 3 秒内看到"成功"或"明确错误原因"之一，绝不允许出现"点了没反应"的体验
- 错误文案直接可指导下一步操作（定位日志 / 检查 Proton / 检查 WeGame 路径）

---

### 4.4 设置（Settings 页面）

内部分子页签：**依赖管理**（主）、**基础设置**、**版本更新**、**缓存与日志管理**。

> 设置页的**首层**只保留子页签切换，**不再**在最上层摆放「重新配置环境」按钮（该按钮现在只出现在"依赖管理"子页签的顶部工具栏中）。

#### 4.4.1 基础设置（子页签，原"高级配置"）

**定位**：WeGame 启动所需的环境变量与启动参数等高级配置项。

**包含内容**：
- 环境变量表（`extra_env_vars`）
- 启动参数（`launch_args`）

**已移除的内容**：
- ❌ 自定义路径配置（Wine 前缀 / Proton / WeGame 安装路径）→ 迁移到"依赖管理"子页签
- ❌ 重置 Wine Prefix 按钮 → 迁移到"依赖管理"子页签
- ❌ "重新配置环境"按钮 → 迁移到"依赖管理"子页签顶部工具栏
- ❌ "保存设置"按钮 → 改为立即生效

**保存机制（新）**：
- **立即生效（防抖 500ms 自动保存）**
  - 环境变量新增/修改/删除后自动保存
  - 启动参数输入后 500ms 无新输入即自动保存
- **危险操作单独确认**：
  - 清空启动参数（点击"恢复默认"）→ `ConfirmDialog`
  - 删除环境变量行 → 直接删除（已有"✕"按钮即可，不额外确认）
  - 自动保存失败时显示 Toast / 错误提示，保留旧值
- 保存成功提供轻量视觉反馈（右上角小绿点 "已保存 ✓"，3 秒后消失）

#### 4.4.2 依赖管理（子页签）

见 4.2。本子页签承载：Winetricks 依赖、中间层管理、路径配置、重置 Prefix、重新配置向导入口。

#### 4.4.3 版本更新（子页签）
见 4.5。

#### 4.4.4 缓存与日志管理（独立子页签或归入基础设置底部区块，实现阶段决定）
- **清理日志文件**功能（原名「清除缓存」）
- 显示日志文件路径和信息
- 清理前弹出确认对话框，防止误操作
- 反馈清理结果（成功/失败）

---

### 4.5 版本更新检查（UpdateChecker）

#### 4.5.1 更新渠道
- **正式版（Stable）**：仅从 GitHub Releases 检测
  - 支持一键下载 AppImage 到本地
  - 下载完成后提示用户关闭当前应用、运行新 AppImage
- **开发版（Dev）**：仅从 GitHub Actions 检测最新成功构建
  - 提供跳转到 Actions 页面的链接，用户手动下载 Artifact
  - 名称命名约定：`Action 版` → 统一称为 **开发版（Dev）**

#### 4.5.2 交互
- 渠道选择卡片：用户可切换当前渠道
- 「检查更新」按钮 → 展示：当前版本、最新版本、发布时间、更新说明
- 下载进度条（字节数 / 百分比）
- 下载完成提示本地文件路径

#### 4.5.3 入口
- 设置页「版本更新」子页签（主入口）
- 「关于帮助」页面快速检查更新入口

---

### 4.6 关于帮助（About 页面）
- 应用版本号、项目介绍
- 快速更新入口（跳转到"版本更新"页签）
- 相关链接（GitHub 仓库等）

---

### 4.7 WeGame 运行诊断（v1.4 新增）

**背景**：实测发现 WeGame 安装包能在 Proton-GE 下启动，但**安装进度一直卡在 0% 不动**。这类问题**几乎不是依赖缺失导致的**，而是 WeGame 自带下载器（TenioDL）在 Wine 网络栈下无法正常工作，或者腾讯 CDN 对当前网络/证书链不信任。

**诊断模块定位**：提供一个独立的诊断入口，辅助用户快速定位 WeGame "启动了但跑不动" 类问题。

**UI 位置**：
- 「启动器」页面：当 WeGame 运行状态异常时，展示「运行诊断」按钮
- 「依赖管理」页面：顶部工具栏保留一个「WeGame 诊断」入口

**诊断项（至少包含）**：

| 检测项 | 说明 | 失败时建议 |
|-------|------|-----------|
| **网络连通性** | `ping` 腾讯 CDN 关键域名（`dldir1.qq.com`、`cdn-go.cn`、`gdl.tencent.com` 等） | 检查网络 / 切换 DNS（推荐 `119.29.29.29` DNSPod） |
| **DNS 解析** | 对上述域名做 `dig` / `nslookup`，检查是否被污染 | 提示更换 DNS |
| **TLS 证书链** | `openssl s_client` 验证腾讯 CDN 的证书链 | 提示更新 `ca-certificates` |
| **TenioDL 进程** | WeGame 运行时检测 Wine 进程中是否存在 `TenioDL.exe` / 下载器子进程 | 未启动 → 可能是 WeGame 主程序问题；已启动但无网络流量 → 网络栈问题 |
| **WeGame 日志解析** | 读取 `%APPDATA%/Tencent/WeGame/logs` 下的日志，提取关键错误码 | 显示给用户，对常见错误码给出建议 |
| **Proton/Wine 版本** | 核对当前 Proton-GE 版本是否满足 WeGame 最低版本要求（社区建议 GE-Proton 8.x 以上） | 建议升级 Proton-GE |
| **Wine 注册表关键项** | 检查 `HKCU\Software\Tencent\WeGame` 是否已初始化 | 提示重新运行 WeGame 初始化 |

**输出**：
- 诊断结果以分组卡片展示：✅ 通过 / ⚠️ 警告 / ❌ 失败
- 每个失败项附带"建议操作"与"一键修复"按钮（如："重置 DNS"、"更新证书"、"切换 Proton 版本"等）
- 诊断报告可**导出为文本**，便于用户在社区反馈时附带

**实现优先级**：P1（高），因为这是当前实测阻塞问题的核心排障工具。

---

## 五、跨模块系统性需求

### 5.1 日志系统（重要）
- **存储路径**：`~/.local/share/decky-wegame/logs/`
- **会话级日志**：每次运行生成唯一会话 ID（`YYYYMMDD_HHMMSS`）
  - 文件命名：`<应用名>_<会话ID>.log`（如 `dependencies_20260418_020106.log`）
  - **禁止所有日志写入同一个文件**
- **日志轮转**：单文件最大 5 MB，保留 10 个历史
- **自动清理**：最多保留 20 个会话日志文件
- **清理入口**：设置页「缓存与日志管理」提供一键清理
- **日志内容要求**：
  - launcher：Proton 路径、环境变量、子进程 stdout/stderr、退出码
  - dependencies：winetricks 命令输出、每个依赖的成功/失败状态

### 5.2 异步处理（重要约束）
- **严禁使用 `execSync` 执行可能阻塞 UI 的命令**，尤其是需要 sudo 的命令
- 所有可能耗时的后端命令必须异步（`spawn`），并在 IPC 层正确处理，避免阻塞主进程

### 5.3 功能分工原则（避免重复）
- **配置向导** = 首次设置流程（扫描、Proton、路径、依赖、跳过）
- **依赖管理** = 日常维护（查看、重装缺失项、全部重装）
- **禁止两处出现重复功能**（如：跳过只在向导中；重新配置入口只在依赖管理子页签中）

### 5.4 CI/CD
- GitHub Actions 自动构建
- 输出两种包：**AppImage**（Steam Deck 主用）+ **deb**
- 构建环境：Ubuntu 22.04

### 5.5 网络与镜像源（v1.4 新增）

**原则**：所有需要从境外拉取资源的场景（winetricks 依赖、Proton-GE 下载、WeGame 安装包代理等）都必须**内置国内镜像源策略**，不得依赖用户自行配置代理。

**覆盖范围**：
- Winetricks 依赖下载（详见 §4.2.2.2）
- Proton-GE / GE-Proton 的 GitHub Release 下载（走 `ghproxy` 反代）
- 应用自身更新下载（AppImage 发布页，走 `ghproxy` 反代）

**实现要求**：
- 所有镜像源配置集中管理，不散落各处
- 提供**可达性自动探测**：每次下载前对候选源做 HEAD 请求（1s 超时），按延迟/可达性排序
- 失败日志必须记录：尝试的源列表、每一步耗时、最终成败
- 严禁硬编码"用户必须自行提供镜像源"的文案

---

## 六、UI / UX 约定

- **风格**：深色主题 + 玻璃拟态（glass-card）+ 霓虹色点缀（neon-primary / neon-secondary）
- **图标库**：lucide-react
- **确认对话框**：破坏性操作必须使用 `ConfirmDialog` 组件确认（跳过、清理日志、重装等）
- **反馈**：所有异步操作需提供加载状态 / 成功提示 / 错误提示

---

## 七、开发流程规则（Workflow）

### 7.1 Git 提交规则
- 每开发完一个功能后**及时 `git commit`**
- **不要随意 `git push`**
- 仅在以下情况推送：
  1. 需要打包新版本时
  2. 用户主动要求 `push`

### 7.2 开发日志（DEVLOG.md）
- 记录**重要架构变更、关键技术决策、核心功能实现、影响方向的重大调整**
- **不记录**：简单 bug 修复、琐碎文件操作、过于详细的技术步骤
- 格式：`日期 + 标题 + 要点列表`

### 7.3 产品需求文档（PRD.md，本文件）
- 所有新增/调整需求、bug 反馈都必须同步到 PRD
- 开发必须严格遵守 PRD
- 遇到 PRD 未覆盖的细节 → **先询问，后补充**，严禁擅自实现

---

## 八、已知待确认事项（Open Questions）

（此处记录尚未明确的需求点，后续与用户沟通后补充到对应章节）

- **WeGame 安装 0% 卡住根因未知**：目前判断大概率是 TenioDL 下载器 + 腾讯 CDN 证书链在 Wine 下的问题，需要通过 §4.7 诊断模块采集更多信息后再定论
- **.NET Framework 是否真的必需**：当前采纳"按需安装"策略；未来若发现 WeGame 某核心功能（如云存档、游戏启动器）明确依赖 .NET，再回写到默认推荐清单
- **镜像源清单的具体 URL**：`mirror-manifest.json` 的初始内容需要在实现阶段通过实机验证可达性后填入，不在 PRD 中硬编码

---

## 九、变更记录（Changelog）

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-04-18 | v1.8.0 | **配置一致性重构**：消除「安装向导」与「依赖管理页」之间的能力/行为割裂。新增 `src/components/config/` 下 3 个共享组件，均支持 `variant="wizard"` 与 `variant="panel"/"manage"` 两种形态：`PathsSection`（Wine Prefix + WeGame 路径）、`ProtonPicker`（Proton 选择/下载 GE-Proton/删除用户持有版本）、`WeGameInstaller`（安装/重装/清缓存）。向导侧的 Step 1 新增「下载最新 GE-Proton」与「winetricks 一键安装到 ~/.local/bin（无需密码）」两个之前只在依赖管理页才有的能力；依赖管理页新增 `<WeGameInstaller variant="manage">` 与单项依赖 hover 来的「重装」按钮，不再需要重走向导。修复 Step 3 原来「依赖缓存路径」标签与 `wegame_install_path` 字段不符的错位 bug。变更后：`SetupWizard.tsx` 1155 → 864 行，`Dependencies.tsx` 802 → 609 行，净减重复 UI 代码 ≈540 行 |
| 2026-04-18 | v1.7.1 | 发现 v1.7 的回归：按照 v1.7 默认「全部依赖按需」的策略，步骤 2 默认无勾选 → 步骤 4 的 `canProceed` 要求 `selectedDeps.length > 0` 导致用户永远进不了步骤 5。修复：步骤 4 允许 0 依赖通过（`canProceed` case 4 改为 `true`）；`handleFinish` 将「0 依赖」归入 `skip_dependency_installation` 分支，绕开 sudo 密码弹窗，同时利用后端 `status: "completed"` 事件触发 useEffect 自动推进步骤 5；步骤 4 的标题与按钮文案按 `selectedDeps.length === 0` 做差异化（「准备完成环境配置」/「创建环境并继续」），避免用户误会「会跑 winetricks」 |
| 2026-04-18 | v1.7 | 向导新增步骤 5「安装 WeGame」：新建 `electron/backend/wegame_installer.ts` （默认从腾讯官方 `dldir1.qq.com` 下载 `WeGameSetup.exe` → 用 Proton 内置 wine64 运行 → 校验 `WeGameLauncher.exe`）、新增 6 个 IPC、单独的 `installerLogger`。依赖策略进一步最小化：`corefonts`/`cjkfonts` 改为默认不勾选（实机日志表明在全新 prefix + 新版 winetricks 下必踩 `c0000135`，而 Proton-GE 已自带 CJK 渲染）。诊断修复：`checkProtonVersion` 在 `config.proton_path` 空/失效时自动回退到 `scanProtonVersions()`。Prefix 兜底：新增 `ensureWinePrefixInitialized`，`syswow64/regedit.exe` 不存在时跳 `wine64 wineboot --init` + `wineserver -w`，install 和 WeGame 安装器流程共用。Launcher 错误横幅检测到「WeGame executable not found」时提供「打开配置向导」直达按钮 |
| 2026-04-18 | v1.6 | 修复"点击启动 WeGame 没反应"：Launcher / Dashboard 的启动与停止按钮加上 loading 状态、顶部错误横幅（显示 err.message + launcher.log 路径）、启动后 3 秒探测并在进程秒退时给黄色警示。新增 §4.3.1 错误反馈与启动探测规范 |
| 2026-04-18 | v1.5 | 性能优化：修复"每次进依赖管理页面卡 2~5 秒"问题。根因是 `checkInstalledWinetricks` 用 `execSync` 同步调用 `winetricks list-installed`，阻塞 Electron 主进程 IPC 队列。新增 §4.2.2.3：依赖状态内存缓存 + 后端 `spawn` 异步化 + 前端占位即渲染 + 手动刷新按钮；安装结束/重置 prefix 自动 invalidate |
| 2026-04-18 | v1.4 | **重大策略调整**：采纳"依赖最小化 + 镜像源兜底 + 诊断模块"三合一方案。理由：1) 实测 WeGame 能启动但安装卡 0%，说明问题不在 Windows 依赖而在网络；2) Proton-GE 已含大部分依赖，重复安装无意义且失败率高；3) .NET 在 Wine 下不稳定，应按需安装。新增 §4.2.2.2 镜像源策略、§4.7 运行诊断模块、§5.5 网络与镜像源；调整 §4.1 步骤 2 与 §4.2.2 依赖分组 |
| 2026-04-18 | v1.3 | 修复依赖安装失败（`wineserver not found`）：明确依赖安装必须使用所选 Proton 内置的 wine/wineserver，补充 §4.2.2.1；无可用 Wine 后端时立即终止并上报清晰错误 |
| 2026-04-18 | v1.2 | 重构设置界面：基础设置改为立即生效（防抖）、路径/重置/重新配置入口迁移到依赖管理子页签，并在依赖管理新增中间层（Wine/winetricks/Proton）管理能力 |
| 2026-04-18 | v1.1 | 修复密码验证问题：前端调用 install_winetricks 但后端未注册 IPC 处理函数，导致密码错误提示 |
| 2026-04-18 | v1.0 | 初始版本：整理之前所有需求，建立 PRD |

### v1.1 修复详情

**问题**：用户报告输入密码后一直提示密码错误

**根本原因**：
1. 前端 SetupWizard 调用 `invoke("install_winetricks", { password })`
2. 但后端 IPC 处理器中没有注册 `install_winetricks` 处理函数
3. 导致调用失败，前端错误处理逻辑显示"密码错误"

**修复方案**：
1. 在 IPC 处理器中添加 `install_winetricks` 处理函数
2. 修复后端 `installWinetricks` 函数的密码验证逻辑，正确识别密码错误
3. 更新前端 API 层，添加 `installWinetricks` 函数导出
4. 修复前端错误处理逻辑，根据错误类型显示不同提示信息

**技术细节**：
- 后端：检查错误输出中的关键词（"Sorry, try again"、"incorrect password"、"Authentication failure"）
- 前端：根据错误消息内容区分密码错误和安装失败
- IPC：正确返回 `{ success: boolean, error?: string }` 格式的响应

