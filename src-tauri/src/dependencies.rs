use crate::types::*;
use anyhow::{Context, Result};
use chrono::Local;
use std::path::PathBuf;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

pub const DEPENDENCY_DEFINITIONS: &[(&str, &str, DependencyCategory, &str, f64, bool)] = &[
    ("dotnet46", ".NET Framework 4.6", DependencyCategory::Dotnet, "WeGame 核心运行时依赖", 180.0, true),
    ("dotnet48", ".NET Framework 4.8", DependencyCategory::Dotnet, "最新版 .NET Framework 运行时（推荐）", 200.0, true),
    ("vcpp2005", "Visual C++ 2005 Redistributable", DependencyCategory::Vcpp, "部分旧组件依赖的 VC++ 运行时", 6.0, false),
    ("vcpp2008", "Visual C++ 2008 Redistributable", DependencyCategory::Vcpp, "部分游戏组件依赖", 9.0, true),
    ("vcpp2010", "Visual C++ 2010 Redistributable", DependencyCategory::Vcpp, "广泛使用的 VC++ 运行时版本", 11.0, true),
    ("vcpp2012", "Visual C++ 2012 Redistributable", DependencyCategory::Vcpp, "部分游戏和工具依赖", 12.0, true),
    ("vcpp2013", "Visual C++ 2013 Redistributable", DependencyCategory::Vcpp, "常用 VC++ 运行时", 13.0, true),
    ("vcpp2015-2022", "Visual C++ 2015-2022 (x64)", DependencyCategory::Vcpp, "最新版 VC++ 运行时集合包", 35.0, true),
    ("font-microsoft-core", "Microsoft Core Fonts", DependencyCategory::Font, "Arial、Times New Roman 等基础字体", 8.0, true),
    ("font-cjk", "CJK Support Fonts (CJKfonts)", DependencyCategory::Font, "中日韩文字支持字体，解决中文乱码问题", 25.0, true),
    ("ie8", "Internet Explorer 8", DependencyCategory::Browser, "WeGame 内嵌浏览器依赖的 IE 内核组件", 150.0, true),
    ("gdiplus", "GDI+ (gdiplus)", DependencyCategory::System, "Windows 图形设备接口库", 3.0, true),
    ("mscoree", ".NET Core Runtime (mscoree)", DependencyCategory::System, ".NET Framework 核心执行引擎", 2.0, true),
    ("directx9", "DirectX 9.0c (d3dx9)", DependencyCategory::System, "DirectX 9 运行时库，部分游戏需要", 50.0, true),
    ("vcrun6", "Visual Basic 6 Runtime (vcrun6)", DependencyCategory::Other, "VB6 运行时兼容层", 5.0, false),
];

pub fn winetricks_id(dep_id: &str) -> &str {
    match dep_id {
        "dotnet46" => "dotnet46",
        "dotnet48" => "dotnet48",
        "vcpp2005" => "vcrun2005",
        "vcpp2008" => "vcrun2008",
        "vcpp2010" => "vcrun2010",
        "vcpp2012" => "vcrun2012",
        "vcpp2013" => "vcrun2013",
        "vcpp2015-2022" => "vcrun2022",
        "font-microsoft-core" => "corefonts",
        "font-cjk" => "cjkfonts",
        "ie8" => "ie8",
        "gdiplus" => "gdiplus",
        "mscoree" => "mscoree",
        "directx9" => "d3dx9",
        "vcrun6" => "vcrun6",
        _ => dep_id,
    }
}

pub fn get_dependency_list() -> Vec<DependencyItem> {
    DEPENDENCY_DEFINITIONS
        .iter()
        .map(|(id, name, cat, desc, size, req)| DependencyItem {
            id: id.to_string(),
            name: name.to_string(),
            category: cat.clone(),
            description: desc.to_string(),
            installed: false,
            size_mb: *size,
            required: *req,
            install_time: None,
        })
        .collect()
}

pub async fn install_dependencies(
    wine_prefix: &PathBuf,
    selected_ids: &[String],
    app_handle: tauri::AppHandle,
) -> Result<()> {
    let total = selected_ids.len() as u32;
    let mut completed: u32 = 0;

    for (idx, dep_id) in selected_ids.iter().enumerate() {
        let wt_id = winetricks_id(dep_id);

        emit_progress(
            &app_handle,
            dep_id.clone(),
            format!("Installing {}...", wt_id),
            ((idx as f64 / total as f64) * 100.0).round(),
            total,
            completed,
            InstallStatus::Running,
            None,
        )
        .await?;

        let result =
            run_winetricks_single(wine_prefix, wt_id, &app_handle).await;

        match result {
            Ok(_) => {
                completed += 1;
                emit_progress(
                    &app_handle,
                    dep_id.clone(),
                    "Completed".to_string(),
                    (((completed as f64) / (total as f64)) * 100.0).round(),
                    total,
                    completed,
                    InstallStatus::Idle,
                    None,
                )
                .await?;
            }
            Err(e) => {
                emit_progress(
                    &app_handle,
                    dep_id.clone(),
                    "Failed".to_string(),
                    0.0,
                    total,
                    completed,
                    InstallStatus::Error,
                    Some(e.to_string()),
                )
                .await?;
            }
        }
    }

    emit_progress(
        &app_handle,
        String::new(),
        "All dependencies installed".to_string(),
        100.0,
        total,
        total,
        InstallStatus::Completed,
        None,
    )
    .await?;

    Ok(())
}

async fn run_winetricks_single(
    prefix_path: &PathBuf,
    winetricks_id: &str,
    app_handle: &tauri::AppHandle,
) -> Result<String> {
    let mut cmd = AsyncCommand::new("winetricks");
    cmd.arg("-q")
        .arg("--unattended")
        .arg(format!("WINEPREFIX={}", prefix_path.display()))
        .arg(winetricks_id)
        .env("WINEPREFIX", prefix_path.to_string_lossy().to_string())
        .env("DISPLAY", ":0");

    let child = cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn()
        .with_context(|| format!("Failed to start winetricks for {}", winetricks_id))?;

    let stdout = child.stdout.expect("failed to capture stdout");
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut output_buf = String::new();

    while let Some(line_result) = lines.next_line().await? {
        let line = line_result.trim().to_string();
        if !line.is_empty() {
            output_buf.push_str(&line);
            output_buf.push('\n');

            let _ = app_handle.emit("log-event", LogPayload {
                level: "info".to_string(),
                message: line,
                timestamp: Local::now().format("%H:%M:%S%.3f").to_string(),
            });
        }
    }

    Ok(output_buf)
}

async fn emit_progress(
    app_handle: &tauri::AppHandle,
    current_dep: String,
    step: String,
    percent: f64,
    total: u32,
    completed: u32,
    status: InstallStatus,
    error_msg: Option<String>,
) -> Result<()> {
    let progress = InstallProgress {
        current_dependency: current_dep,
        current_step: step,
        progress_percent: percent,
        total_steps: total,
        completed_steps: completed,
        status,
        error_message: error_msg,
    };

    app_handle
        .emit("install-progress", &progress)
        .context("Failed to emit install-progress event")?;
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct LogPayload {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
