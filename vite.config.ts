import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// beamhop dev server lives on its own port range to coexist with other projects
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
  },
});
