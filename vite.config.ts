import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// beamhop dev server lives on its own port range to coexist with other projects
export default defineConfig({
  // Served at the root of the custom domain https://beamhop.com (see public/CNAME),
  // so built asset URLs live at the site root rather than a repo subpath.
  base: "/",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
  },
});
