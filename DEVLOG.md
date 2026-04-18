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
