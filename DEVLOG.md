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
