import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// beamhop dev server lives on its own port range to coexist with other projects
export default defineConfig({
  // Served at the root of the custom domain https://beamhop.com (see public/CNAME),
  // so built asset URLs live at the site root rather than a repo subpath.
  base: "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      // Multi-page: the marketing site at "/", the pitch deck at "/deck", and
      // the standalone protocols page at "/protocols". Relative keys preserve
      // directory structure, so deck/index.html builds to dist/deck/index.html
      // and serves cleanly at /deck on GitHub Pages.
      input: {
        main: "index.html",
        deck: "deck/index.html",
        protocols: "protocols/index.html",
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
  },
});
