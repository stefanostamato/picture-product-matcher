import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "shared/": new URL("../shared/src/", import.meta.url).pathname,
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
