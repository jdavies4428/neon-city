import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    hmr: {
      timeout: 5000,
      overlay: true,
    },
    proxy: {
      "/api": "http://localhost:5174",
      "/ws": {
        target: "ws://localhost:5174",
        ws: true,
      },
    },
  },
});
