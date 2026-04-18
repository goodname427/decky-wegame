# WeGame Launcher 产品需求文档 (PRD)

> 本文件是 **WeGame Launcher** 项目的唯一产品需求来源，面向**开发者**描述软件当前的功能定义与规范。所有新增需求、需求调整、bug 反馈都必须同步更新到本文件。
> 后续开发必须**严格遵守**本文件；如遇未覆盖的细节，应先向产品负责人询问确认，再补充到本文件中。
>
> **文档约束**：PRD 只描述当前版本的产品需求，**不保留版本沿革标签**（如「（vX.Y 新增）」），**不维护 Changelog**。历史变更请阅 [DEVLOG.md](./DEVLOG.md)。

- **项目名称**：WeGame Launcher（decky-wegame）
- **目标平台**：SteamOS / Steam Deck（Linux）
- **目标用户**：希望在 Steam Deck 上运行腾讯 WeGame 平台及其游戏的**国内玩家**（具备一定折腾能力但不愿手动处理镜像 / 代理 / 翻墙的电子发烧友）
- **当前版本**：v1.13.0
- **最后更新**：2026-04-18

---

## 一、产品原则（最高宪法）

本章列出的原则优先级**高于**本文件中任何其它章节的具体规格描述；任何具体功能设计与实现决策出现分歧时，以本章原则为准。

### 1.1 产品定位

一款运行在 SteamOS / Steam Deck 上的**独立桌面应用**，用于在 Linux 环境下一站式**配置、启动、管理**腾讯 WeGame 游戏平台，屏蔽 Wine/Proton 相关的复杂配置细节。

### 1.2 核心用户画像

- **地理**：国内用户（主要运行环境是国内网络，无稳定境外出口）
- **设备**：Steam Deck（SteamOS 不可写根分区、无系统 `wine` / 默认无 `sudo` 习惯、网络栈对境外资源不友好）
- **期望**：把游戏跑起来；不希望理解 Wine / Proton / winetricks / dotnet 的内部差异
- **能力**：会基本命令行、能装 AppImage、但不愿手动配置代理/镜像/证书

### 1.3 产品原则清单（P0 / P1）

所有设计决策必须通过以下原则的筛选：

#### P0（不可违反）

1. **一站式体验**：从打开应用到成功启动 WeGame，**全程不需要用户自行搭梯子 / 配镜像 / 找资源包 / 跑命令**。任何需要用户手动处理的外部依赖都必须由本应用**内置多源兜底**解决。
2. **不装绕不开的雷**：不把默认策略建立在"用户愿意装一堆可能用不到的 Windows 依赖"之上；默认策略必须是**当前证据链上确实能跑通**的最小组合。
3. **失败可恢复**：任何自动流程失败都必须给出**具体的下一步操作**（哪怕只是"打开浏览器去某个页面下载文件"），而不是丢一行栈追踪给用户。
4. **不依赖外部生态的长期存活**：外部镜像 / CDN / 第三方站点可能随时挂掉，本产品必须具备**热切换镜像池**与**用户侧手动注入**两条逃生路径。
5. **不上传第三方版权二进制**：不把 WeGame、.NET、VC++ 等第三方的二进制捆绑进 Release；必须通过合法的镜像或用户主动下载来获取。

#### P1（强烈建议，除非有明确反证）

6. **高级玩家逃生舱**：在默认的"一站式"体验之外，必须始终保留一个显眼的入口，让具备技术能力的用户跳过自动流程，进入**完全可控的高级模式**（即原 5 步向导的完整 UI）。
7. **SSoT 不散落**：所有 URL、镜像池、哨兵文件列表、资源清单都必须集中到单一模块（目前是 `electron/backend/mirrors.ts` + 本 PRD 的 §5.6）；业务代码不得散落硬编码。
8. **可观测性优先**：每一次下载 / 安装 / 启动都必须有清晰的 `LogXxx` 类别日志，失败时错误横幅直接给出"看哪个文件的哪一行"。
9. **默认配置 > 用户配置 > 自动探测**：用户显式提供的配置优先级最高；其次是应用内置默认；最后才是运行时探测。三者不得互相覆盖。
10. **不把"用户折腾"当作功能**：禁止以"用户可以自己改配置就能解决"作为不内置兜底能力的借口。

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
- 可在「设置」页点击「重新运行安装向导」按钮手动打开
- 以 Modal 弹窗形式呈现（非常驻页签）

---

## 四、功能模块详细需求

### 4.1 环境设置向导（SetupWizard）

**设计哲学**：遵循 §1.3 P0「一站式体验」与 P1「高级玩家逃生舱」双原则，向导入口拆分为**两条路径**——

#### 4.1.0 首启分流：欢迎页 → 用户主动选择

首次打开应用时，**不直接执行任何配置动作**，先展示一张「**欢迎页（WelcomeScreen）**」让用户主动选择路径，避免高级玩家在已经启动的自动流程里被动跳转。

**欢迎页布局（单屏、极简）**
- 顶部一句话说明：「接下来将为你配置 WeGame 运行环境（选择 Proton、创建 Wine Prefix、安装依赖、引导安装 WeGame 本体）。」
- 屏幕中央一个**大号主按钮**：「🚀 一键自动安装」 —— 尺寸明显大于页面其它元素，是视觉焦点
- 主按钮下方辅助文字：「全程 2-5 分钟（视网络而定），任何步骤失败会引导你手动处理。」
- 屏幕底部角落一个**小号次级按钮**：「高级模式 →」 —— 浅色、低对比度，不抢视觉焦点，但始终可见
- 右下角一个「稍后再说 / 暂时跳过」链接，允许用户关闭向导先探索应用（此时未安装 WeGame 的状态在启动器页会有红色横幅提醒）

**交互分流**：
- 用户点**大按钮**「一键自动安装」→ 切换到「**自动配置进度页（AutoSetup）**」，**此时才**开始依次执行：选择推荐 Proton → 创建 / 修复 Wine Prefix → 预拉取核心依赖到 winetricks 缓存 → 引导安装 WeGame 本体
- 用户点**小按钮**「高级模式」→ 直接进入 §4.1.1 的完整 5 步向导，**跳过欢迎页、也跳过自动配置**
- 用户点「稍后再说」→ 关闭向导，进入应用主界面

**为什么这样设计**（写给后续维护者）：
- 如果首启就自动开跑，高级玩家只能"在执行中途按跳过"，这违反 §1.3 P1 第 6 条"高级玩家逃生舱"的精神——**逃生舱应当在动作开始前就醒目可见**
- 大小按钮的尺寸对比本身就是一种**默认策略表达**：绝大多数用户走大按钮（一站式），少数高级用户走小按钮（完全掌控）

##### 4.1.0.1 自动配置进度页（AutoSetup）

**仅当用户在欢迎页点了大按钮后进入**。本页是一个**线性进度页**，不是多步向导。

- 顶部固定展示整体进度条（X/4 阶段，已耗时 Y 秒）
- 中部展示当前阶段名与子进度（例如「正在下载 GE-Proton-9-20…  45% / 180MB」）
- 底部展示最近 10 行日志尾巴（可展开全部），符合 §1.3 P1 第 8 条
- 自动依次执行四个阶段：
  1. **选择 Proton**：有 Valve 官方 Proton 优先选；否则从镜像池下载 GE-Proton
  2. **创建 / 修复 Wine Prefix**：走 §4.2.2.1 的 `ensureWinePrefixInitialized` + 三文件健康检查
  3. **预拉取核心依赖**：走 §5.6.3 的 winetricks 缓存预填（best-effort，失败只告警不阻塞）
  4. **引导安装 WeGame 本体**：走 §4.1.1.5 三层兜底
- 成功收尾：弹出**成功卡片**「准备完成，可在依赖管理页进一步微调」+ 直达「启动 WeGame」主按钮
- 任何阶段失败：把用户平滑**降级**到对应的手动兜底动作（示例：GE-Proton 下载失败 → 请求切换到已有的 Valve 官方 Proton；winetricks 预填部分失败 → 继续，只在末尾成功卡片里列出"未命中缓存的 verbs"并提示"日后如遇错再装"；WeGame 自动下载全失败 → 自动弹出「选择本地安装器文件」）
- **WeGame 阶段失败时自动诊断**：stage 4 失败（包括 installer 正常退出但未产出 `WeGameLauncher.exe` 的静默失败情况）时，后端自动运行一次网络 / 环境诊断（§4.7），把 `DiagnosticReport` 附到 error 卡片上，把 HTTPS 不通 / DNS 异常 / Proton 缺失等根因直接显示给用户，避免"一站式体验"变成"跳来跳去"
- **installer-silent 软警告**：Wine 安装器启动后若 stdout/stderr 3 分钟没有新输出，自动在进度卡片叠一条黄色提示「安装器疑似卡住 — 可能是腾讯 CDN TLS 握手被阻塞」并给出「切到高级模式」快捷逃生按钮，避免无声无息的悬停
- **中途逃生**：本页右上角常驻一个次级按钮「切换到高级模式 →」，点击后**中止当前自动流程**（会 SIGTERM 正在跑的 installer 子进程，30s 后不退则 SIGKILL 兜底），用目前已完成的状态（已选好的 Proton、已创建的 prefix 等）预填高级模式的对应字段，让用户接着往下配

##### 4.1.0.2 欢迎页 / 高级模式入口汇总

欢迎页（§4.1.0）的合法入口有两个：
- **首启**：prefix 不存在时自动弹出
- **依赖管理页顶部「重新运行安装向导」按钮**：事后回到欢迎页，用户可选一键重跑或进高级模式

高级模式（§4.1.1）的合法入口有两个：
- 欢迎页右下角小按钮「高级模式 →」（首启首选入口）
- 自动配置进度页右上角「切换到高级模式 →」（执行中途逃生）

**约束**：
- 欢迎页、自动配置页、高级模式**共用同一套后端 IPC 与共享组件**（§4.2.6），严禁三处 UI 实现逻辑漂移
- 自动配置每完成一步，都必须在 UI 上主动提示：「可在依赖管理页进一步调整」，建立用户对「高级微调」入口的认知
- 欢迎页**不得**预先触发任何网络请求或磁盘写操作；只有用户明确点下大按钮/小按钮后才能开始实际工作


#### 4.1.1 高级模式：原 5 步向导

向导共 **5 个步骤**，每步独立切换，支持「上一步」「下一步」「跳过向导」。

##### 步骤 1：确认中间层
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

##### 步骤 2：确认依赖

**设计哲学**：采纳「依赖最小化」策略 —— **先让 WeGame 跑起来，缺什么再补什么**，而不是一次性预装一堆可能用不到的 Windows 依赖。

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

> **关于字体依赖**：`corefonts` / `cjkfonts` 默认不勾选。在新建 prefix + GE-Proton 环境下，winetricks 新版安装字体时会因 `syswow64\regedit.exe` 未初始化而踩 `c0000135 (DLL_NOT_FOUND)`，且 Proton-GE 本身已能正常渲染中文，默认装这两个字体弊大于利。
**UI 要求**：
- 页面顶部明显展示一条提示条：「🎯 推荐策略：先尝试直接运行 WeGame，遇到具体报错再来此处补装对应依赖」
- 提供「**一键全选（完整安装）**」按钮（老派用户兑底）
- 提供「**恢复推荐**」按钮：会取消全部勾选，鼓励用户进入第 5 步先试运行 WeGame
- 每个依赖项点击可展开**详细说明**（解决什么问题、失败常见原因）
**跳过依赖安装**：允许用户在步骤 2 直接"跳过依赖安装"进入步骤 3，**不再强制要求装依赖**。

##### 步骤 3：路径选择
- **功能优化**：专注于配置下载内容的保存路径
- **配置内容**：
  - 中间层安装路径（Wine、Proton等）
  - 依赖组件缓存路径
  - 临时下载目录
- **约束**：所有路径必须配置完成后才能进入下一步

##### 步骤 4：执行安装
- 点击「开始安装」后：
  1. 保存环境配置
  2. 初始化 Wine Prefix
  3. **基础初始化兜底**：对 Wine 前缀做**三文件健康检查**——
     `<prefix>/drive_c/windows/syswow64/regedit.exe`、
     `<prefix>/drive_c/windows/syswow64/kernel32.dll`、
     `<prefix>/drive_c/windows/system32/kernel32.dll` 必须全部存在。
     任一缺失即视为前缀残缺：
     - 若前缀目录为空或不存在，直接运行 `wine64 wineboot --init` 完成首次初始化。
     - 若前缀目录已存在但缺失其一（例如之前的 wineboot 被中断、或曾被以 32-bit 模式初始化过），
       **先将整个前缀目录清空**，再运行 `wine64 wineboot --init` 重建，
       随后复核三文件健康状态；仍不健康时中止并提示用户重下 GE-Proton。
     `wineboot` 运行时显式固定 `WINEARCH=win64`，避免外部环境变量污染导致 arch 不一致。
     这一兜底用来规避后续 winetricks 或 WeGame 安装器踩 `c0000135 (DLL_NOT_FOUND)` 的坑。
  4. 检测 winetricks 是否可用：
     - 不可用 → **弹出密码输入弹窗**（见 4.1.1）
     - 可用 → 直接开始依赖安装
- 安装过程展示进度条、当前步骤、完成步骤数
- 安装完成后，向导**自动推进到步骤 5**（如用户已使用「跳过向导」全局跳过则不推进）。
- **0 依赖分支**：若用户在步骤 2 没有勾选任何依赖，步骤 4 标题显示「准备完成环境配置」，按钮文案切换为「创建环境并继续」；后端路由到 `skip_dependency_installation` 仅做 prefix 初始化，**跳过 winetricks 与 sudo 密码弹窗**，随后依靠相同的 `status: "completed"` 事件推进至步骤 5。

##### 步骤 5：安装 WeGame

**背景**：向导完成后 WeGame 本体应直接可用，避免用户点「启动」时出现 `WeGame executable not found` 且无任何引导。因此「安装 WeGame 本体」作为向导的必要收尾步骤。

- **自动检测**：进入该步后立即调用 `check_wegame_installed`、搜索以下路径：
  - `<prefix>/drive_c/Program Files/Tencent/WeGame/WeGameLauncher.exe`
  - `<prefix>/drive_c/Program Files (x86)/Tencent/WeGame/WeGameLauncher.exe`
  - `<prefix>/drive_c/Program Files/Tencent/WeGame/WeGame.exe`
  - 用户自定义的 `wegame_install_path`
- **已安装**：展示绿色「已安装」卡片 + 完整可执行文件路径；提供「用本地文件重新安装」与「在线重新下载（实验）」两个按钮（用于覆盖安装或升级）。
- **未安装**：展示黄色提示卡 + 三按钮：
  - 主推「在线下载并安装」（调用 `install_wegame`，走 §4.1.1.5 的三层兜底）
  - 次级「选择本地安装器文件」（调用 `pick_wegame_installer` 原生文件选择器 → `install_wegame_from_local`，作为全部在线源失败时的终极兜底）
  - 粘底「打开官网」（`window.open("https://www.wegame.com.cn/")` 在系统浏览器打开，给用户一个验证渠道）

**4.1.1.5 WeGame 安装器的三层兜底（关键实现约束）**

遵循 §1.3 P0「一站式体验」与 P1「外部资源内置多源降级」原则，WeGame 安装器下载采用三层降级：

| 层级 | 策略 | 说明 |
|---|---|---|
| **L1** | 运行时抓官网动态解析 | 请求 `https://www.wegame.com.cn/` 首页，解析「立即下载」按钮背后的 CDN 直链（若腾讯恢复对公网的稳定静态链接，**永远拿到最新版**） |
| **L2** | 内置候选 URL 池 | §5.6.2 定义的 `DEFAULT_WEGAME_INSTALLER_URL_CANDIDATES` 硬编码列表，**按优先级依次 HEAD 探测**（10s 超时，要求 200 + content-length > 1 MB）；同时支持 `extra_env_vars.WEGAME_INSTALLER_URL` 让高级用户指向自维护镜像 |
| **L3** | 本地文件选择器 | 前两层全部失败时，UI **自动**弹出「选择本地安装器文件」入口并附加官网跳转按钮，引导用户从浏览器下载后导入 |

**实现要求**：
- 三层之间的降级**必须是自动的**：L1 失败 → 自动进入 L2；L2 全部失败 → UI 立即呈现 L3 入口（不是让用户再点一次「重试」）
- L1 的抓取实现置于 `electron/backend/wegame_installer.ts` 内的 `resolveWegameDownloadUrlFromOfficialSite()`，失败不抛错，只返回 `null` 让调用方进入 L2
- L2 的候选列表集中维护在 `electron/backend/mirrors.ts`（§5.6），不得散落到其它文件
- L3 的文件校验沿用现有 `installWegameFromLocalFile` 约束（存在 / 是文件 / ≥ 1 MB / `.exe` 扩展名）

- **共享安装终点**：三层最终都调 `runWegameInstaller`，通过 `resolveWineBackendEnv()` + `ensureWinePrefixInitialized()` 确保 prefix 可用，`spawn(wine64, "WeGameSetup.exe")` 后以 5 秒一次心跳推进条（上限 80%），进程退出后再次 `isWegameInstalled` 校验即完成。
- **失败恢复**：错误卡一律引导用户「选本地文件」（L3 入口常驻），同时保留「打开官网」、「重试在线下载」、「清缓存并重新下载」三个动作。
- **日志**：使用 `Log.category("Installer")` 类别（行前缀 `LogInstaller:`），与其它模块共享同一个会话级日志文件，grep 即可过滤出安装器相关的行。
- **跳过**：任何时候点右下角「稍后安装并完成」或「完成」都允许结束向导，仅在 `wegameInstalled===true` 时按钮文案为「完成」。

**IPC 接口**（已暴露给前端 `src/utils/api.ts`）：

| IPC 名 | 说明 |
|--------|------|
| `get_wegame_installer_info` | 返回缓存路径/是否已缓存/大小/**候选 URL 列表**/官网下载页 |
| `check_wegame_installed` | 检查 prefix 中是否已有 WeGameLauncher.exe |
| `download_wegame_installer` | **按候选源依次探测 + 下载（不运行）** |
| `run_wegame_installer` | 运行指定路径的安装器 |
| `install_wegame` | 一键「下载 + 安装」（实验性在线路径） |
| `pick_wegame_installer` | Electron 原生文件选择器，过滤器 `*.exe`，返回 `{ canceled, filePath }` |
| `install_wegame_from_local` | 从用户选定的本地 `.exe` 安装（主路径） |
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

##### 4.1.1.6 密码输入弹窗（sudo 权限获取）
- **触发条件**：安装 winetricks 时需要 sudo 权限
- **UI 要求**：
  - 标题：「需要管理员权限」
  - 说明：安装 winetricks 需要管理员权限，请输入密码继续
  - 输入框：type=password，autoFocus
  - 按钮：「取消」「确认」
  - 错误提示：输入为空显示「请输入密码」；密码错误显示「密码错误，请重新输入」并重新弹出
- **后端行为**：通过 `echo "$password" | sudo -S` 方式传递密码

#### 4.1.2 跳过功能（Skipping）

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

1. **重新运行安装向导**（主按钮）
   - 图标：`Wand2` / `Settings`，风格 `neon-primary`
   - 点击后打开「环境设置向导」Modal，默认回到欢迎页（§4.1.0），用户可重新选择"一键自动安装"或进入高级模式
   - 说明副标题：用于回到欢迎页重新走完整流程或微调
2. **安装缺失项**（次按钮，保留）
3. **全部重装**（次按钮，保留）

#### 4.2.2 Winetricks 依赖列表

- 依赖列表按「推荐 / 按需」分组，默认勾选策略遵循 §4.1 步骤 2 的依赖分层表。
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

#### 4.2.2.2 下载镜像源策略

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

#### 4.2.2.3 依赖状态缓存与异步刷新

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
  - Proton 扫描范围覆盖**两类目录**：
    1. 第三方兼容层：`~/.steam/root/compatibilitytools.d/`、`~/.local/share/Steam/compatibilitytools.d/`、`/usr/share/steam/compatibilitytools.d/`（目录下任意子目录只要含可执行的 `proton` 脚本即视为候选）
    2. Valve 官方 Proton：`~/.steam/root/steamapps/common/`、`~/.local/share/Steam/steamapps/common/`（由于此目录同时包含游戏本体，**只认名字匹配 `Proton*` 的子目录**，如 `Proton 8.0` / `Proton - Experimental` / `Proton Hotfix`）
  - 同一个 `proton` 脚本被两条路径命中时（`~/.steam/root` 通常是 `~/.local/share/Steam` 的软链）按 `realpath` 去重
  - 排序：GE-Proton → Valve 官方 Proton → 其他（同组内按版本号倒序）；默认推荐（`is_recommended`）仍仅为 GE-Proton
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

#### 4.2.6 配置一致性

**背景**：「安装向导」与「依赖管理页」本质上是**同一套配置**的两种呈现（首次引导 vs. 日常维护），必须保证**功能对等、行为一致**；历史上两者曾出现如「向导没有下载 GE-Proton」「字段 label 与实际字段不符」等割裂问题。

**约束**：两者本质上是**同一套配置**的两种呈现（首次引导 vs. 日常维护），必须保证**功能对等、行为一致**。

**实现方式**：抽出 `src/components/config/` 下 3 个共享组件，统一作为「唯一事实来源」；SetupWizard 与 Dependencies 页面以 `variant` 属性选择呈现形态。

| 组件 | 职责 | `variant` 值 | 前端事件/IPC |
|---|---|---|---|
| `<PathsSection>` | 编辑 `wine_prefix_path` + `wegame_install_path` | `wizard` / `panel` | `save_config_cmd`（变量后防抖保存；wizard 模式通过 `onLocalChange` 回传暂存） |
| `<ProtonPicker>` | 列出 Proton / 切换 / 下载 GE-Proton / 删除用户持有版本 | `wizard` / `panel` | `get_proton_versions` / `download_ge_proton` / `delete_proton_version` + `middleware-download-progress` 事件 |
| `<WeGameInstaller>` | 检测 / 选本地文件安装 / 在线下载安装 / 重装 / 清缓存 WeGame，支持状态回传 | `wizard` / `manage` | `check_wegame_installed` / `pick_wegame_installer` / `install_wegame_from_local` / `install_wegame` / `clear_wegame_installer_cache` + `wegame-install-progress` 事件 + `onStatusChange` 回调 |

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

#### 4.3.1 错误反馈与启动探测

原则：所有异步操作在界面上必须给出明确反馈，避免用户见到「点了没反应」且无法定位日志。

- **启动中状态**
  - 点击"启动 WeGame"后，按钮立即进入 `disabled + loading` 状态（旋转图标 + "启动中…"文案），避免用户连点
  - 按钮禁用直到后端 IPC 返回或超时
- **即时错误反馈**
  - IPC 抛出的任何错误（如 `No Proton version found` / `WeGame executable not found` / spawn 失败）必须以**页面顶部红色横幅**（dismissable）形式展示 `err.message` 全文
  - 横幅下方附一行灰色小字："详细日志：`~/.local/share/decky-wegame/logs/latest.log`（自动指向最近一次会话）"
  - 横幅保留直到用户关闭或下一次成功操作
- **启动后探测**
  - 启动命令返回后，等待 3 秒再 `refetch` WeGame 状态
  - 若此时 `status.running === false`（进程秒退），展示**黄色警示横幅**："WeGame 进程已启动但随即退出，可能是 prefix 损坏或依赖缺失。查看 `latest.log` 中 `LogLauncher:` 相关行（尤其 `[stderr]` 与 `exited with code` 附近内容）定位原因"
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

> 设置页的**首层**只保留子页签切换，**不再**在最上层摆放「重新运行安装向导」按钮（该按钮现在只出现在"依赖管理"子页签的顶部工具栏中）。

#### 4.4.1 基础设置（子页签，原"高级配置"）

**定位**：WeGame 启动所需的环境变量与启动参数等高级配置项。

**包含内容**：
- 环境变量表（`extra_env_vars`）
- 启动参数（`launch_args`）

**已移除的内容**：
- ❌ 自定义路径配置（Wine 前缀 / Proton / WeGame 安装路径）→ 迁移到"依赖管理"子页签
- ❌ 重置 Wine Prefix 按钮 → 迁移到"依赖管理"子页签
- ❌ "重新运行安装向导"按钮 → 迁移到"依赖管理"子页签顶部工具栏
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

### 4.7 WeGame 运行诊断

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

**设计风格**：对齐 Unreal Engine 的 `Log<Category>: <Verbosity>: <msg>` 风格。

- **存储路径**：`~/.local/share/decky-wegame/logs/`
- **会话级单文件**：每次运行生成唯一会话 ID（`YYYYMMDD_HHMMSS`），所有模块、所有等级的日志**写入同一个文件**：`decky-wegame_<会话 ID>.log`。**禁止再按模块拆分文件**（旧版的 `dependencies_*.log / installer_*.log / launcher_*.log` 已废弃）。
- **latest.log**：会话启动时在同一目录下同步写一份 `latest.log`（截断写），作为「最近一次会话」的固定入口，方便用户反馈问题时不用找时间戳。
- **Category**：每个模块用 `Log.category("Xxx")` 申请专属 logger，输出行前缀就是 `LogXxx:`（如 `LogDeps:` / `LogInstaller:` / `LogLauncher:` / `LogWineBoot:`），便于 `grep`。
- **Verbosity**：`Fatal / Error / Warning / Display / Log / Verbose / VeryVerbose`（与 UE 一致）。行格式：`[2026.04.18-18.25.32:161] LogWineBoot: Warning: prefix unhealthy ...`；Verbosity=`Log` 时省略等级前缀。
- **阈值**：文件默认落盘全部等级（`VeryVerbose` 也写）；控制台默认 `Log` 及以上上屏（`Verbose / VeryVerbose` 只落盘，不干扰开发台）。
- **会话数量限制**：最多保留最近 20 个会话日志文件，超出自动清理最旧的；不再按单文件大小轮转。
- **清理入口**：设置页「缓存与日志管理」提供一键清理（清空 `logs/` 整个目录）。
- **内容要求**：
  - `LogLauncher`：Proton 路径、环境变量、子进程 stdout/stderr、退出码。
  - `LogDeps` / `LogWineBoot`：winetricks 命令输出、wineboot --init 的 stdout/stderr（VeryVerbose 落盘）、每个依赖的成败状态。
  - `LogInstaller`：下载跟踪、WeGameSetup.exe 运行结果。
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

### 5.5 网络与镜像源（顶层原则）

**原则**：所有需要从境外拉取资源的场景（winetricks 依赖、Proton-GE 下载、WeGame 安装包代理等）都必须**内置国内镜像源策略**，不得依赖用户自行配置代理。

**覆盖范围**：
- Winetricks 依赖下载（详见 §4.2.2.2）
- Proton-GE / GE-Proton 的 GitHub Release 下载（走 `ghproxy` 反代）
- WeGame 安装器下载（详见 §4.1.1.5 三层兜底）
- 应用自身更新下载（AppImage 发布页，走 `ghproxy` 反代）

**实现要求**：
- 所有镜像源配置集中管理，不散落各处
- 提供**可达性自动探测**：每次下载前对候选源做 HEAD 请求（10s 超时），按延迟/可达性排序
- 失败日志必须记录：尝试的源列表、每一步耗时、最终成败
- 严禁硬编码"用户必须自行提供镜像源"的文案

### 5.6 外部资源下载策略（细则）

本节是 §5.5 的**具体实现细则**，规定本项目需要从外部下载的所有资源、每类资源的镜像池、下载器的通用接口与降级行为。目的是：**任何镜像失效时，只改本节登记表即可热修；不得在业务代码里散落镜像 URL**。

#### 5.6.1 资源清单（SSoT）

以下是**本应用目前需要从外部拉取的所有资源**。新增资源时必须先登记到本表，否则视为违反 §1.3 P1 第 7 条。

| 资源 ID | 用途 | 典型大小 | 文件名 | 校验方式 |
|---|---|---|---|---|
| `proton-ge` | GE-Proton 兼容层 | ~400 MB | `GE-Proton*.tar.gz` | GitHub Release 的 `sha512sums.txt`（若可用） |
| `wegame-installer` | WeGame 官方安装器 | ~6 MB（外壳） | `WeGameSetup.exe` | 大小 > 1 MB + PE 格式 |
| `dep-dotnet48` | .NET Framework 4.8 | ~80 MB | `dotnet48.exe` | winetricks 已内置的 sha256（若可用） |
| `dep-dotnet46` | .NET Framework 4.6 | ~70 MB | `NDP46-KB3045557-x86-x64-AllOS-ENU.exe` | winetricks 已内置的 sha256（若可用） |
| `dep-vcrun2019` / `dep-vcrun2022` | VC++ 运行库 | ~25 MB 每个 | `vc_redist.x64.exe` 等 | winetricks 已内置的 sha256 |
| `dep-corefonts` | 微软核心字体 | ~12 MB | 多个 `.EXE` | winetricks 已内置的 sha256 |
| `dep-d3dx9` | DirectX 9 | ~6 MB | `directx_Jun2010_redist.exe` | winetricks 已内置的 sha256 |
| `app-update` | 应用自身更新包 | ~80-120 MB | `WeGame_Launcher-*.AppImage` | Release 的 `*.yml` + sha512 |

> 具体 URL 与镜像池清单不在本 PRD 中硬编码（会过期），由 `electron/backend/mirrors.ts` 维护；本表只登记资源**存在**与**约束**。

#### 5.6.2 镜像池与优先级

##### A. GitHub 资源加速镜像池（用于 Proton-GE、winetricks verbs 的 GitHub 备份、应用自更新）

按顺序探测，首个返回 200 的即用：

| 优先级 | 镜像前缀 | 说明 |
|---|---|---|
| P0 | `https://gh-proxy.com/` | 主力加速器，支持 release / raw / archive |
| P1 | `https://ghproxy.net/` | 备用 1 |
| P2 | `https://ghproxy.homeboyc.cn/` | 备用 2 |
| P3 | `https://mirror.ghproxy.com/` | 备用 3 |
| P4 | `https://github.com/` | 原始兜底，给有代理的用户用 |

**用法**：将原始 `https://github.com/<owner>/<repo>/releases/...` 拼在镜像前缀后即可，路径结构不变。

##### B. WeGame 安装器候选池（用于 §4.1.1.5 的 L2 层）

- **L1 动态解析**：`https://www.wegame.com.cn/` 首页抓取（实现在 `resolveWegameDownloadUrlFromOfficialSite()`）
- **L2 硬编码候选**：`DEFAULT_WEGAME_INSTALLER_URL_CANDIDATES` 按序探测（目前列表见 `mirrors.ts`，腾讯已知常用 CDN 域名作为候选哨兵，过期即移除）
- **用户自定义覆盖**：`extra_env_vars.WEGAME_INSTALLER_URL` 优先级最高，始终插入候选列表最前
- **L3 本地文件**：`pick_wegame_installer` 原生文件选择器，作为 L1/L2 全失败时的终极兜底

##### C. winetricks verb 资源镜像池（用于 §4.2.2.2 / §5.6.3 的缓存预填）

- **P0 国内公开镜像**：腾讯云 / 清华 TUNA / 中科大 USTC / 华为云（各 verb 具体命中哪个镜像由 `mirror-manifest.json` 指定，不统一）
- **P1 GitHub Release 备份**：在本项目 Release 上传 `deps-<verb>-<version>.<ext>`，通过镜像池 A 反代访问
- **P2 winetricks 原生下载**：作为最后兜底，允许失败并把错误上报到 UI

#### 5.6.3 winetricks 缓存预填充机制

**动机**：winetricks 的下载 URL 硬编码在它自己的 shell 脚本中，且 `WINETRICKS_DOWNLOADER` 这类环境变量只切换下载工具不能改 URL；要让 winetricks 走国内源，**最稳妥的做法是在调用 winetricks 之前，由本应用自行把文件下好并塞进 winetricks 的缓存目录**，winetricks 运行时发现缓存已存在就会直接复用、不再联网下载。

**实现要求**：

1. **缓存目录**：`~/.cache/winetricks/<verb>/<expected-filename>`（与 winetricks 原生约定对齐）
2. **预填触发时机**：依赖安装主循环的最开始，`installDependencies` 在 `resolveWineBackendEnv` 完成后、进入单项 winetricks 调用之前；best-effort 语义，任何一项预填失败**不得阻塞**整个依赖安装流程，只记录 warn 日志
3. **输入**：以 verb id 为 key 从 `mirror-manifest.json` 查出镜像池候选；输入用户配置的 `WINETRICKS_MIRROR_URL_<verb>` 覆盖项（若存在）
4. **下载器**：共用 §5.6.5 的 `downloadFromMirrorPool(poolId, candidates)` 抽象；下载完成后必须校验文件大小 ≥ 1 MB 且非空，若 manifest 中提供了 `sha256` 则再做一次哈希校验
5. **命中判定**：若 `~/.cache/winetricks/<verb>/` 下已存在符合大小 + 哈希的文件，**直接跳过**该 verb 的预填（避免重复下载）

**不做的事**：
- 不内置任何第三方版权资源的哈希或直链（仅维护指向公开镜像的元信息）
- 不试图篡改 winetricks 脚本本身

#### 5.6.4 镜像健康度检测（可选，未来做）

- 应用启动后、或用户在"依赖管理"页主动触发时，对当前 `mirror-manifest.json` 中的所有镜像做一轮 HEAD 探测
- 结果以"🟢 可达 / 🟡 慢 / 🔴 不可达"三档展示，便于用户判断是否该切换镜像
- **P2 优先级**，暂不落地

#### 5.6.5 开发者维护指引（重要）

- 所有新增下载入口**必须**经过 `mirrors.ts` 里的 `downloadFromMirrorPool(poolId, candidates, opts)` 抽象，禁止业务代码直接写 `https.get` / `fetch` 去某个具体 URL
- 新增一种"资源类别"时的标准流程：
  1. 到 §5.6.1 登记资源 ID / 用途 / 校验方式
  2. 到 `mirror-manifest.json` 追加该资源的镜像池配置
  3. 业务代码以 `downloadFromMirrorPool("<poolId>", ...)` 触发下载
  4. 在本 PRD 的对应功能章节写清用户可见的失败回退路径
- 镜像 URL 过期是**常态**，不触发升 MINOR；只需改动 `mirrors.ts` 并追加一条 DEVLOG

---

### 5.7 跨模块禁止事项（反向约束）

配合 §1 产品原则，明确列出**禁止**的做法，违反则视为 bug：

- ❌ 在业务代码里硬编码某个具体的外部 URL（应走 §5.6.5 的 `downloadFromMirrorPool`）
- ❌ 在错误横幅里只给英文栈追踪不给下一步操作
- ❌ 向用户抛出"请配置 $HTTP_PROXY"/"请自行翻墙"/"请提供本地镜像"等要求用户做运维的文案
- ❌ 复制粘贴向导或管理页的 UI 组件（应走 §4.2.6 的共享组件）
- ❌ 绕过 SSoT 直接改 README / PRD 里的版本号字面量（应先改 `package.json` 的 `version`）



---

## 六、UI / UX 约定

- **风格**：深色主题 + 玻璃拟态（glass-card）+ 霓虹色点缀（neon-primary / neon-secondary）
- **图标库**：lucide-react
- **确认对话框**：破坏性操作必须使用 `ConfirmDialog` 组件确认（跳过、清理日志、重装等）
- **反馈**：所有异步操作需提供加载状态 / 成功提示 / 错误提示

---

## 七、开发流程规则（Workflow）

项目的 Git 提交、分支、文档同步等协作规则由项目内部的 Agent 规则文件（`.codebuddy/rules/devoloper.md`）统一维护，本文件不再重复。

**PRD 相关的关键约束**：
- 所有新增 / 调整需求、bug 反馈都必须同步到本文件，开发必须严格遵守。
- PRD 未覆盖的细节 → **先询问，后补充**，严禁擅自实现。
- PRD 只描述当前版本，不保留版本沿革标签，不维护 Changelog。

---

## 八、已知待确认事项（Open Questions）

（此处记录尚未明确的需求点，后续与用户沟通后补充到对应章节）

- **WeGame 安装 0% 卡住根因未知**：目前判断大概率是 TenioDL 下载器 + 腾讯 CDN 证书链在 Wine 下的问题，需要通过 §4.7 诊断模块采集更多信息后再定论
- **.NET Framework 是否真的必需**：当前采纳“按需安装”策略；未来若发现 WeGame 某核心功能（如云存档、游戏启动器）明确依赖 .NET，再回写到默认推荐清单
- **镜像源清单的具体 URL**：`mirror-manifest.json` 的初始内容需要在实现阶段通过实机验证可达性后填入，不在 PRD 中硬编码

---

## 附：变更历史

本文件不再维护 Changelog。历史版本的关键变更（何时、为何做、涉及哪些文件、关键技术决策）统一记录在 [DEVLOG.md](./DEVLOG.md)；逐行代码变更由 `git log` 承担。

