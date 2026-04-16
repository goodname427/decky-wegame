import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { InstallProgress } from "../types";

const DEFAULT_PROGRESS: InstallProgress = {
  current_dependency: "",
  current_step: "",
  progress_percent: 0,
  total_steps: 0,
  completed_steps: 0,
  status: "idle",
};

export function useInstallProgress() {
  const [progress, setProgress] = useState<InstallProgress>(DEFAULT_PROGRESS);
  const [logs, setLogs] = useState<Array<{ level: string; message: string; timestamp: string }>>([]);

  useEffect(() => {
    const unlisten1 = listen<InstallProgress>("install-progress", (event) => {
      setProgress(event.payload);
    });

    const unlisten2 = listen<{ level: string; message: string; timestamp: string }>(
      "log-event",
      (event) => {
        setLogs((prev) => [...prev.slice(-500), event.payload]);
      }
    );

    return () => {
      unlisten1.then((fn) => fn());
      unlisten2.then((fn) => fn());
    };
  }, []);

  const reset = useCallback(() => {
    setProgress(DEFAULT_PROGRESS);
    setLogs([]);
  }, []);

  return { progress, logs, reset };
}

export default useInstallProgress;
