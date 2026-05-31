import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "@beamhop/store": resolve(import.meta.dirname, "../store/src/index.ts"),
    },
  },
  optimizeDeps: {
    // Gun is CommonJS; pre-bundle it for the browser.
    include: ["gun"],
  },
  server: {
    port: 5173,
  },
});
