// Bridge layer: abstracts backend communication
// In Electron mode, uses window.electronAPI (exposed via preload)
// Type declarations for ElectronAPI are in src/vite-env.d.ts

function getAPI(): ElectronAPI {
  if (window.electronAPI) {
    return window.electronAPI;
  }
  // Fallback for dev without Electron
  return {
    invoke: async (channel: string, ...args: unknown[]) => {
      console.warn(`[api] invoke "${channel}" called without Electron backend`, args);
      throw new Error(`Backend not available: ${channel}`);
    },
    on: (channel: string) => {
      console.warn(`[api] listen "${channel}" called without Electron backend`);
      return () => {};
    },
  };
}

/**
 * Invoke a backend command via IPC.
 * Replaces Tauri's invoke() function.
 */
export async function invoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const api = getAPI();
  const result = await api.invoke(command, args);
  return result as T;
}

/**
 * Listen for events from the backend.
 * Replaces Tauri's listen() function.
 * Returns an unsubscribe function.
 */
export function listen<T = unknown>(
  event: string,
  handler: (payload: T) => void
): () => void {
  const api = getAPI();
  return api.on(event, (...args: unknown[]) => {
    const payload = args[0] as T;
    handler(payload);
  });
}
