import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://beamhop.github.io",
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
        { label: "Overview", link: "/" },
        {
          label: "Beambox",
          items: [
            { label: "About", link: "/beambox/" },
            { label: "Reference", link: "/packages/beambox/" },
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
      ],
    }),
  ],
});
