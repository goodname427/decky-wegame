import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WeGameStatus } from "../types";

export function useWegameStatus(pollInterval = 3000) {
  const [status, setStatus] = useState<WeGameStatus>({ running: false });
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const result: WeGameStatus = await invoke("get_wegame_status_cmd");
      setStatus(result);
    } catch (err) {
      console.error("Failed to fetch WeGame status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  return { status, loading, refetch: fetchStatus };
}
