import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// beamhop dev server lives on its own port range to coexist with other projects
export default defineConfig({
  // Served as a GitHub Pages project site at https://beamhop.github.io/beamhop/,
  // so every built asset URL must be prefixed with the repo subpath.
  base: "/beamhop/",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
  },
});
