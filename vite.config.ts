import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // Use relative paths so Electron can load local files via file:// protocol
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
  },
});
