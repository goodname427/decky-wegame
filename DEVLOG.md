# 开发日志 (Development Log)

本文件记录 WeGame Launcher 项目的开发过程、功能变更和重要决策。

---

## 2026-04-16 — 项目初始化 & Tauri 框架搭建

- **项目创建**：初始化 WeGame Launcher 项目，目标是在 SteamOS / Steam Deck 上运行腾讯 WeGame
- **技术栈**：React 18 + TypeScript + TailwindCSS（前端），Tauri + Rust（后端）
- **核心功能模块**：
  - 环境初始化（Wine Prefix 创建）
  - Proton 版本管理（自动检测 GE-Proton）
  - 依赖安装（通过 winetricks 安装 .NET、VC++、字体等）
  - WeGame 启停管理
  - 游戏库扫描 & 添加到 Steam
  - 高级设置（自定义路径、环境变量、启动参数）
- **CI/CD**：配置 GitHub Actions 自动构建，产出 deb 包

## 2026-04-17 — CI 构建调试 & AppImage 支持

- **AppImage 构建**：修改 CI 配置，从仅产出 deb 改为同时产出 deb + AppImage（Steam Deck 需要 AppImage 格式）
- **CI 环境调试**：
  - 尝试 Arch Linux 容器构建（匹配 SteamOS），遇到 AppImage 需要 FUSE 的问题
  - 尝试修复 gdk-pixbuf loaders 路径问题
  - 最终切换回 Ubuntu 22.04 构建以解决 GLIBC 兼容性
- **EGL 崩溃问题**：Steam Deck 上运行 Tauri AppImage 时遇到 `Could not create default EGL display: EGL_BAD_PARAMETER` 错误
  - 尝试 `WEBKIT_DISABLE_DMABUF_RENDERER=1` 环境变量 → 无效
  - 根本原因：AppImage 打包的 WebKitGTK 库与 Steam Deck GPU 驱动不兼容

## 2026-04-17 — 从 Tauri 迁移到 Electron

- **决策**：由于 Tauri 的 WebKitGTK/EGL 兼容性问题无法在 Steam Deck 上解决，决定迁移到 Electron
  - Electron 自带 Chromium，不依赖系统 WebView，彻底解决 EGL 问题
  - 前端代码（React + TailwindCSS）几乎零改动
  - 后端从 Rust 改为 Node.js/TypeScript（核心逻辑是调用 shell 命令，Node.js 更简单）
- **迁移工作**：
  - 创建 `electron/` 目录，包含 `main.ts`、`preload.ts`、`ipc.ts`
  - 将 Rust 后端 9 个模块逐一迁移为 TypeScript：`config.ts`、`environment.ts`、`proton.ts`、`launcher.ts`、`dependencies.ts`、`steam.ts`、`types.ts`
  - 创建前端桥接层 `src/utils/api.ts`，替代 Tauri 的 `invoke`/`listen`
  - 适配所有前端 hooks 和 pages（8 个文件），从 `@tauri-apps/api` 迁移到 Electron IPC
  - 更新 `package.json`（添加 Electron 依赖，移除 Tauri 依赖）
  - 创建 `electron-builder.yml` 配置
  - 更新 GitHub Actions 为 Electron 构建流程
- **移除废弃代码**：删除 `src-tauri/` 目录和 `install.sh` 脚本
- **更新 README**：统一采用 GitHub Actions 打包方式

## 2026-04-17 — CI 构建修复

- **deb 打包修复**：添加 `author` 和 `description` 到 `package.json`（electron-builder 构建 deb 时必需）

## 2026-04-18 — UI 重构：页签整合 & 日志系统

- **页签重构**：
  - 将 6 个页签精简为 4 个：控制台、启动器、设置、关于帮助
  - 环境设置从常驻页签改为首次打开时自动弹出的 Modal 向导
  - 依赖管理和高级配置合并到「设置」页签，内部分子页签切换
  - 在设置页添加「重新配置环境」按钮，支持重新打开向导
- **日志系统**：
  - 新增 `logger.ts` 通用日志模块，日志存储在 `~/.local/share/decky-wegame/logs/`
  - 为 launcher.ts 添加完整日志（Proton 路径、环境变量、子进程 stdout/stderr、退出码）
  - 为 dependencies.ts 添加安装日志（winetricks 命令输出、成功/失败状态）
  - 支持日志轮转（单文件最大 5MB，保留 3 个历史文件）
- **依赖安装修复**：
  - 修复 `getDependencyList()` 始终返回 `installed: false` 的 bug → 新增 `checkInstalledWinetricks()` 检测已安装包
  - 修复全部安装失败仍显示"完成"的 bug → 区分全部成功/部分失败/全部失败三种状态
  - 安装完成后自动刷新依赖列表
- **TS 编译修复**：
  - 修复 `prefixInfo` 类型断言问题（TS18046）
  - 修复 `unlinkSync` 返回值调用 `.toString` 的问题

## 2026-04-18 — 环境检查 & 版本更新检查

- **环境检查步骤**：在设置向导中新增第一步「环境检查」
  - 自动检测 Wine 和 winetricks 是否已安装
  - 未安装时显示详细安装指引（包括 SteamOS 解锁只读文件系统的方法）
  - 未通过检测时阻止进入下一步
- **版本更新检查**：
  - 后端：新增 `updater.ts` 模块，支持两个更新渠道
    - 正式版（Stable）：从 GitHub Releases 检测，支持一键下载 AppImage
    - 开发版（Dev）：从 GitHub Actions 检测最新成功构建
  - 前端：新增 `UpdateChecker.tsx` 组件
    - 渠道选择、检查更新、版本对比、更新说明展示
    - 下载进度条、下载完成提示
  - 集成到设置页「版本更新」子页签和关于页面快速检查入口

## 2026-04-18 — 依赖扫描功能

- **依赖扫描系统**：将环境设置向导第一步从简单的"有/无"检测改为完整的扫描+选择流程
  - 后端：新增 `dep-scanner.ts` 模块
    - 扫描 Wine 和 winetricks 在系统中的所有路径（PATH、已知目录、Proton 内置、Flatpak 等）
    - 支持 glob 通配符路径解析
    - 路径验证功能（检查文件存在、可执行权限、运行 `--version`）
  - 前端：改造向导第一步 UI
    - 扫描到多个路径时显示列表供选择（默认选第一个），附带版本号和来源标签
    - 自定义路径：手动输入 + 后端验证
    - 下载安装：显示安装命令和外部链接
    - 所有依赖必须解决后才能进入下一步
- **修复**：修复后端 `types.ts` 中多余的 `}` 语法错误

## 2026-04-18 — 依赖安装失败修复 & 日志系统改进

- **依赖安装失败修复**：
  - 问题：所有依赖安装失败，日志显示 `spawn winetricks ENOENT` 错误
  - 原因：系统未安装 winetricks 命令
  - 修复：在 `dependencies.ts` 中添加 winetricks 自动检测和安装逻辑
    - 新增 `isWinetricksAvailable()` 检测函数
    - 新增 `installWinetricks()` 自动安装函数（通过 curl 下载并安装到 /usr/local/bin）
    - 在安装依赖前先检查并安装 winetricks
    - 安装失败时提供手动安装指引

- **日志系统改进**：
  - 问题：所有日志写入同一个文件，不利于调试和历史追踪
  - 改进：重构 `logger.ts`，实现会话级日志管理
    - 每次运行生成唯一会话ID（格式：YYYYMMDD_HHMMSS）
    - 日志文件命名：`应用名_会话ID.log`（如：`dependencies_20240418_020106.log`）
    - 保留向后兼容性：同时写入会话文件和 `应用名.log` 最新文件
    - 自动清理：最多保留 20 个会话日志文件，防止磁盘空间占用
    - 日志轮转：单文件最大 5MB，自动轮转保留 10 个历史文件

- **设置页面增强**：
  - 新增「缓存与日志管理」模块
    - 添加「清理日志文件」功能，一键删除所有历史日志
    - 显示日志文件信息和存储路径
    - 清理状态反馈（成功/失败提示）
    - 清理确认对话框，防止误操作

- **依赖管理跳过功能**：
  - 新增「跳过安装」按钮，允许用户跳过当前依赖安装
  - 跳过状态显示：在依赖列表中标记已跳过的项目
  - 跳过警告提示：显示跳过的依赖数量和影响说明
  - 跳过确认对话框：提醒用户跳过可能影响功能
  - 后端支持：新增 `skip_dependency_installation` IPC 接口
  - 状态管理：记录已跳过的依赖，支持后续重新安装

- **API 接口扩展**：
  - 新增 `skipDependencyInstallation()` API 方法
  - 新增 `cleanupLogs()` API 方法
  - 更新 IPC 处理函数支持新功能

- **文件修改**：
  - `electron/backend/dependencies.ts`：添加 winetricks 检测和安装
  - `electron/backend/logger.ts`：重构日志系统，支持会话级日志
  - `src/pages/Settings.tsx`：添加日志清理界面
  - `src/pages/Dependencies.tsx`：添加跳过功能界面
  - `electron/ipc.ts`：添加新 IPC 接口
  - `src/utils/api.ts`：添加新 API 方法

## 2026-04-18 — 修复依赖安装无响应问题

- **问题**：依赖安装过程中软件直接无响应，卡在winetricks安装步骤
- **根本原因**：`installWinetricks()` 函数使用 `execSync()` 同步执行需要管理员权限的命令（`sudo mv`），导致进程阻塞等待用户输入密码，UI线程被挂起
- **解决方案**：
  - 将 `installWinetricks()` 改为异步函数，使用 `spawn()` 替代 `execSync()`
  - 添加超时机制（60秒），防止进程无限期等待
  - 改进错误处理，提供更清晰的错误信息
  - 在IPC层正确处理异步操作，避免阻塞主线程
- **修改文件**：`electron/backend/dependencies.ts`
- **效果**：依赖安装过程不再阻塞UI，用户可以正常使用软件界面，安装失败时有明确的错误提示

## 2026-04-18 — 重构依赖管理功能，减少功能重复

- **问题**：依赖管理Tab与配置向导功能重复，用户心智负担重
- **重构方案**：
  - **移除依赖管理页面的跳过安装功能**：将跳过安装功能移至配置向导中
  - **优化功能分工**：
    - 配置向导：首次设置流程，包含依赖扫描、Proton选择、路径配置、依赖安装/跳过
    - 依赖管理：日常依赖维护，支持安装缺失项、全部重装
  - **移除重复功能**：
    - 从依赖管理页面移除跳过安装按钮和确认对话框
    - 移除相关的状态管理（skippedDeps、showSkipConfirm等）
    - 清理残留的跳过安装相关代码引用
  - **在配置向导中添加跳过安装功能**：
    - 在步骤4（确认依赖）添加跳过安装选项
    - 添加跳过安装确认对话框
    - 实现跳过安装的处理逻辑
- **修改文件**：
  - `src/pages/Dependencies.tsx`：移除跳过安装相关功能
  - `src/pages/SetupWizard.tsx`：添加跳过安装功能
- **效果**：功能分工更清晰，减少用户混淆，提升使用体验

## 2026-04-18 — 修复TypeScript编译错误

- **问题**：构建过程中出现TypeScript编译错误，影响打包流程
- **错误详情**：
  - `SetupWizard.tsx(772,8): error TS2304: Cannot find name 'ConfirmDialog'`
  - `Dependencies.tsx(204,23): error TS2304: Cannot find name 'skippedDeps'`
  - `Dependencies.tsx(229,26): error TS2304: Cannot find name 'skippedDeps'`
- **修复方案**：
  - **SetupWizard.tsx**：添加缺失的ConfirmDialog组件导入
  - **Dependencies.tsx**：添加skippedDeps状态变量定义，类型为Set<string>
- **修改文件**：
  - `src/pages/SetupWizard.tsx`：添加`import ConfirmDialog from "../components/ConfirmDialog";`
  - `src/pages/Dependencies.tsx`：添加`const [skippedDeps, setSkippedDeps] = useState<Set<string>>(new Set());`
- **效果**：TypeScript编译错误已修复，构建流程可以正常进行
