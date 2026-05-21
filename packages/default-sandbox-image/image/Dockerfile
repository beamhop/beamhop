FROM phusion/baseimage:noble-1.0.3

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget git sudo vim tmux zsh \
      build-essential unzip locales \
 && locale-gen en_US.UTF-8 \
 && rm -rf /var/lib/apt/lists/*

# Node 20 (for npm-installed CLIs)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Bun (installed as root, moved system-wide so the dev user inherits it)
RUN export BUN_INSTALL=/usr/local \
 && curl -fsSL https://bun.sh/install | bash \
 && /usr/local/bin/bun --version

# Pre-install claude + pi so first launch is instant (no bunx download stalls)
RUN npm i -g \
      @anthropic-ai/claude-code \
      @zed-industries/claude-code-acp \
      pi-acp

# Non-root dev user with passwordless sudo
RUN useradd -m -s /usr/bin/zsh -G sudo dev \
 && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev \
 && chmod 0440 /etc/sudoers.d/dev

USER dev
WORKDIR /home/dev

# Oh-my-zsh unattended, then drop our zshrc on top.
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

COPY assets/zshrc /home/dev/.zshrc
COPY assets/motd /home/dev/.motd

ENV SHELL=/usr/bin/zsh
ENV HOME=/home/dev

CMD ["/usr/bin/zsh", "-l"]
