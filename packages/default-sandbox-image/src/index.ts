import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stable tag for the bundled default sandbox image. Bumping the suffix forces
 * a fresh build; existing snapshots stay on disk under their old digest.
 */
export const DEFAULT_TAG = "beamhop-default:v1";

/**
 * Inline Dockerfile — source of truth at build time. The `image/Dockerfile`
 * on disk mirrors this so humans browsing the repo see it, but the string
 * here is what beambox feeds into `SandboxImage.fromDockerfileString`.
 *
 * COPY paths resolve against `getDefaultContextDir()`, which points at the
 * bundled `image/` directory.
 */
export const DEFAULT_DOCKERFILE = `FROM phusion/baseimage:noble-1.0.3

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \\
      ca-certificates curl wget git sudo vim tmux zsh \\
      build-essential unzip locales \\
 && locale-gen en_US.UTF-8 \\
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
 && apt-get install -y --no-install-recommends nodejs \\
 && rm -rf /var/lib/apt/lists/*

RUN export BUN_INSTALL=/usr/local \\
 && curl -fsSL https://bun.sh/install | bash \\
 && /usr/local/bin/bun --version

RUN npm i -g \\
      @anthropic-ai/claude-code \\
      @zed-industries/claude-code-acp \\
      pi-acp

RUN useradd -m -s /usr/bin/zsh -G sudo dev \\
 && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev \\
 && chmod 0440 /etc/sudoers.d/dev

USER dev
WORKDIR /home/dev

RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

COPY assets/zshrc /home/dev/.zshrc
COPY assets/motd /home/dev/.motd

ENV SHELL=/usr/bin/zsh
ENV HOME=/home/dev

CMD ["/usr/bin/zsh", "-l"]
`;

/**
 * Absolute path to the `image/` directory shipped with this package, used as
 * the build context so COPY directives can reach `assets/`. Works under both
 * source layout (`src/index.ts` next to `image/`) and built layout (`dist/`
 * next to `image/`) because we resolve relative to this module's URL and
 * walk one level up.
 */
export function getDefaultContextDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "image");
}

export interface DefaultImage {
  tag: string;
  dockerfile: string;
  contextDir: string;
}

export function getDefaultImage(): DefaultImage {
  return {
    tag: DEFAULT_TAG,
    dockerfile: DEFAULT_DOCKERFILE,
    contextDir: getDefaultContextDir(),
  };
}
