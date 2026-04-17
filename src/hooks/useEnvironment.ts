import { useState, useEffect, useCallback } from "react";
import { invoke } from "../utils/api";
import type { EnvironmentConfig, SystemInfo, ProtonInfo } from "../types";

const DEFAULT_CONFIG: EnvironmentConfig = {
  wine_prefix_path: "~/.local/share/decky-wegame/prefix",
  proton_path: "",
  wegame_install_path:
    "~/.local/share/decky-wegame/prefix/drive_c/Program Files/Tencent/WeGame",
  extra_env_vars: {},
  launch_args: "",
};

export function useEnvironment() {
  const [config, setConfig] = useState<EnvironmentConfig>(DEFAULT_CONFIG);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    try {
      const result: EnvironmentConfig = await invoke("get_config");
      setConfig(result || DEFAULT_CONFIG);
    } catch (err) {
      console.error("Failed to fetch config:", err);
      // Keep default config
    }
  }, []);

  const fetchSystemInfo = useCallback(async () => {
    try {
      const info: SystemInfo = await invoke("get_system_info");
      setSystemInfo(info);
    } catch (err) {
      console.error("Failed to fetch system info:", err);
    }
  }, []);

  const saveEnvironment = useCallback(async (newConfig: EnvironmentConfig) => {
    await invoke("save_config_cmd", { config: newConfig });
    setConfig(newConfig);
  }, []);

  useEffect(() => {
    async function init() {
      await Promise.all([fetchConfig(), fetchSystemInfo()]);
      setLoading(false);
    }
    init();
  }, [fetchConfig, fetchSystemInfo]);

  return {
    config,
    systemInfo,
    loading,
    refetch: fetchConfig,
    refetchSystem: fetchSystemInfo,
    saveEnvironment,
  };
}

function useProtonVersions() {
  const [versions, setVersions] = useState<ProtonInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const result: ProtonInfo[] = await invoke("get_proton_versions");
      setVersions(result);
    } catch (err) {
      console.error("Failed to fetch Proton versions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  return { versions, loading, refetch: fetchVersions };
}

export { useEnvironment as default, useProtonVersions };
