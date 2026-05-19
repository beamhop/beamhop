import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Served under https://beamhop.github.io/beamhop/ — repo isn't named
// beamhop.github.io so Pages adds the /beamhop/ subpath. Starlight's sidebar
// auto-prefixes `base` to root-relative `link:` values; do NOT pre-prefix
// here or you'll get /beamhop/beamhop/... on inner pages.
export default defineConfig({
  site: "https://beamhop.github.io",
  base: "/beamhop/",
  integrations: [
    starlight({
      title: "beamhop",
      description:
        "Sandboxed builds, remote-shell primitives, and a browser-to-coding-agent bridge.",
      logo: {
        dark: "./src/assets/beamhop-icon-dark.png",
        light: "./src/assets/beamhop-icon-light.png",
        replacesTitle: false,
      },
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
        { label: "Overview", link: "/" },
        {
          label: "Beambox",
          items: [
            { label: "About", link: "/beambox/" },
            { label: "beambox", link: "/packages/beambox/" },
            { label: "sandbox-exec", link: "/packages/sandbox-exec/" },
          ],
        },
        {
          label: "Shell suite",
          items: [
            { label: "How it fits together", link: "/shell/" },
            { label: "shell-protocol", link: "/packages/shell-protocol/" },
            { label: "shell-client", link: "/packages/shell-client/" },
            { label: "shell-server", link: "/packages/shell-server/" },
            { label: "shell-relay", link: "/packages/shell-relay/" },
          ],
        },
        {
          label: "ACP suite",
          items: [
            { label: "How it fits together", link: "/acp/" },
            { label: "acp-protocol", link: "/packages/acp-protocol/" },
            { label: "acp-server", link: "/packages/acp-server/" },
            { label: "acp-client", link: "/packages/acp-client/" },
            { label: "acp-p2p", link: "/packages/acp-p2p/" },
            { label: "acp-relay", link: "/packages/acp-relay/" },
          ],
        },
        {
          label: "Host glue",
          items: [
            { label: "host-orchestrator", link: "/packages/host-orchestrator/" },
            { label: "invite-link", link: "/packages/invite-link/" },
          ],
        },
      ],
    }),
  ],
});
