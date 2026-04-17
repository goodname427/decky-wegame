import { useState, useEffect } from "react";
import { invoke } from "../utils/api";
import { listen } from "../utils/api";
import {
  RefreshCw,
  Download,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Radio,
  ArrowUpCircle,
  FileText,
} from "lucide-react";
import type { UpdateChannel, UpdateInfo } from "../types";
import { APP_VERSION } from "../utils/constants";

const CHANNEL_OPTIONS: { id: UpdateChannel; label: string; description: string }[] = [
  {
    id: "stable",
    label: "正式版",
    description: "仅检查 GitHub Releases 中的正式发布版本，更稳定可靠",
  },
  {
    id: "dev",
    label: "开发版",
    description: "检查 GitHub Actions 中的最新构建，获取最新功能但可能不稳定",
  },
];

export default function UpdateChecker() {
  const [channel, setChannel] = useState<UpdateChannel>("stable");
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    percent: number;
    downloaded: number;
    total: number;
  } | null>(null);
  const [downloadResult, setDownloadResult] = useState<string | null>(null);

  // Listen for download progress events
  useEffect(() => {
    const unlisten = listen<{ percent: number; downloaded: number; total: number }>(
      "update-download-progress",
      (payload) => {
        setDownloadProgress(payload);
      }
    );
    return unlisten;
  }, []);

  async function handleCheckUpdate() {
    setChecking(true);
    setError(null);
    setUpdateInfo(null);
    setDownloadResult(null);

    try {
      const info = (await invoke("check_for_update", { channel })) as UpdateInfo;
      setUpdateInfo(info);
    } catch (err) {
      setError(`检查更新失败: ${(err as Error).message}`);
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload() {
    if (!updateInfo?.download_url || !updateInfo?.file_name) return;

    // For dev channel, open the Actions page in browser
    if (updateInfo.channel === "dev") {
      window.open(updateInfo.html_url, "_blank");
      return;
    }

    setDownloading(true);
    setDownloadProgress(null);
    setDownloadResult(null);

    try {
      const filePath = (await invoke("download_and_install_update", {
        downloadUrl: updateInfo.download_url,
        fileName: updateInfo.file_name,
      })) as string;
      setDownloadResult(filePath);
    } catch (err) {
      setError(`下载失败: ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Channel Selection */}
      <div className="glass-card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-100">
          <Radio className="h-4.5 w-4.5 text-primary" />
          更新渠道
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CHANNEL_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                setChannel(opt.id);
                setUpdateInfo(null);
                setError(null);
                setDownloadResult(null);
              }}
              className={`flex flex-col items-start rounded-lg border p-4 text-left transition-all ${
                channel === opt.id
                  ? "border-primary/50 bg-primary/8 ring-1 ring-primary/30"
                  : "border-white/5 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div
                  className={`h-3 w-3 rounded-full ${
                    channel === opt.id
                      ? "bg-primary shadow-sm shadow-primary/50"
                      : "bg-gray-600"
                  }`}
                />
                <span
                  className={`text-sm font-semibold ${
                    channel === opt.id ? "text-primary" : "text-gray-200"
                  }`}
                >
                  {opt.label}
                </span>
              </div>
              <p className="text-xs text-gray-500 ml-5">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Check Update Button */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-100">
            <ArrowUpCircle className="h-4.5 w-4.5 text-accent" />
            检查更新
          </h3>
          <span className="text-xs text-gray-500">
            当前版本: <span className="font-mono text-gray-400">v{APP_VERSION}</span>
          </span>
        </div>

        <button
          onClick={handleCheckUpdate}
          disabled={checking}
          className="neon-primary flex items-center gap-2 text-sm"
        >
          {checking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {checking ? "正在检查..." : "检查更新"}
        </button>

        {/* Error */}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-neon-red/20 bg-neon-red/5 p-3">
            <AlertTriangle className="h-4 w-4 text-neon-red mt-0.5 shrink-0" />
            <p className="text-xs text-gray-300">{error}</p>
          </div>
        )}

        {/* Update Result */}
        {updateInfo && !error && (
          <div className="mt-4 space-y-4">
            {updateInfo.has_update ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <ArrowUpCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-primary">发现新版本！</h4>
                    <div className="mt-2 space-y-1 text-xs text-gray-400">
                      <p>
                        当前版本: <span className="font-mono text-gray-300">{updateInfo.current_version}</span>
                      </p>
                      <p>
                        最新版本: <span className="font-mono text-primary">{updateInfo.latest_version}</span>
                      </p>
                      {updateInfo.published_at && (
                        <p>
                          发布时间: <span className="text-gray-300">{new Date(updateInfo.published_at).toLocaleString("zh-CN")}</span>
                        </p>
                      )}
                    </div>

                    {/* Release Notes */}
                    {updateInfo.release_notes && (
                      <div className="mt-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FileText className="h-3.5 w-3.5 text-gray-500" />
                          <span className="text-xs font-medium text-gray-400">更新说明</span>
                        </div>
                        <div className="rounded bg-surface-dark/80 p-2.5 text-xs text-gray-400 max-h-[120px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                          {updateInfo.release_notes}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="mt-4 flex items-center gap-3">
                      {updateInfo.channel === "stable" && updateInfo.download_url ? (
                        <button
                          onClick={handleDownload}
                          disabled={downloading}
                          className="neon-primary flex items-center gap-2 text-sm"
                        >
                          {downloading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {downloading ? "下载中..." : "下载更新"}
                        </button>
                      ) : updateInfo.channel === "dev" && updateInfo.html_url ? (
                        <a
                          href={updateInfo.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="neon-primary flex items-center gap-2 text-sm inline-flex"
                        >
                          <ExternalLink className="h-4 w-4" />
                          前往下载
                        </a>
                      ) : null}

                      {updateInfo.html_url && updateInfo.channel === "stable" && (
                        <a
                          href={updateInfo.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="neon-secondary flex items-center gap-1.5 text-xs"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          查看详情
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Download Progress */}
                {downloading && downloadProgress && (
                  <div className="mt-4 space-y-2">
                    <div className="h-2 rounded-full bg-surface-dark overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
                        style={{ width: `${downloadProgress.percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{downloadProgress.percent}%</span>
                      <span>
                        {formatBytes(downloadProgress.downloaded)} / {formatBytes(downloadProgress.total)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Download Complete */}
                {downloadResult && (
                  <div className="mt-4 rounded-lg border border-neon-green/20 bg-neon-green/5 p-3">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-neon-green mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-neon-green font-medium">下载完成！</p>
                        <p className="mt-1 text-xs text-gray-400">
                          文件已保存到: <span className="font-mono text-gray-300 break-all">{downloadResult}</span>
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          请关闭当前应用，然后运行新版本的 AppImage 文件来完成更新。
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-neon-green/20 bg-neon-green/5 p-4 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-neon-green shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-neon-green">已是最新版本</h4>
                  <p className="mt-0.5 text-xs text-gray-400">
                    当前版本 <span className="font-mono">{updateInfo.current_version}</span> 已经是
                    {updateInfo.channel === "stable" ? "正式版" : "开发版"}渠道的最新版本。
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info Card */}
      <div className="glass-card p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-neon-yellow mt-0.5 shrink-0" />
          <div className="text-xs text-gray-400 space-y-1">
            <p><strong className="text-gray-300">正式版</strong>：从 GitHub Releases 获取，经过测试的稳定版本。支持一键下载。</p>
            <p><strong className="text-gray-300">开发版</strong>：从 GitHub Actions 获取，包含最新代码变更。需要手动从 Actions 页面下载 Artifact。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
