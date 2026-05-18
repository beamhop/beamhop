import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Served under https://beamhop.github.io/beamhop/ — repo isn't named
// beamhop.github.io so Pages adds the /beamhop/ subpath. Every site-internal
// URL has to include this prefix; Starlight's sidebar does not auto-prefix.
const BASE = "/beamhop/";

const withBase = (path) => `${BASE.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

export default defineConfig({
  site: "https://beamhop.github.io",
  base: BASE,
  integrations: [
    starlight({
      title: "beamhop",
      description:
        "Sandboxed builds and remote-shell primitives. One repo, two product lines.",
      logo: { src: "./src/assets/logo.svg", replacesTitle: false },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/beamhop",
        },
      ],
      customCss: ["./src/styles/theme.css"],
      editLink: {
        baseUrl: "https://github.com/beamhop/beamhop/edit/main/apps/docs/",
      },
      sidebar: [
        { label: "Overview", link: withBase("/") },
        {
          label: "Beambox",
          items: [
            { label: "About", link: withBase("/beambox/") },
            { label: "Reference", link: withBase("/packages/beambox/") },
          ],
        },
        {
          label: "Shell suite",
          items: [
            { label: "How it fits together", link: withBase("/shell/") },
            { label: "shell-protocol", link: withBase("/packages/shell-protocol/") },
            { label: "shell-client", link: withBase("/packages/shell-client/") },
            { label: "shell-server", link: withBase("/packages/shell-server/") },
            { label: "shell-relay", link: withBase("/packages/shell-relay/") },
          ],
        },
      ],
    }),
  ],
});
