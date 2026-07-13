import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Local dev mirrors the nginx routing used in docker compose.
      "/api": "http://localhost:4000",
      "/v1": "http://localhost:4000",
    },
  },
});
