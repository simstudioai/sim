FROM node:22-bookworm-slim

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    cron \
    curl \
    git \
    gosu \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai

RUN groupadd -g 1001 opencode && \
    useradd -m -u 1001 -g opencode -s /bin/bash opencode

WORKDIR /app

RUN mkdir -p \
    /app/repos \
    /home/opencode/.config/opencode \
    /home/opencode/.local/state \
    /home/opencode/.local/share/opencode

COPY docker/opencode/entrypoint.sh /usr/local/bin/opencode-entrypoint.sh
COPY docker/opencode/git-askpass.sh /usr/local/bin/git-askpass.sh
COPY docker/opencode/healthcheck.sh /usr/local/bin/opencode-healthcheck.sh
COPY docker/opencode/sync-repos.sh /usr/local/bin/sync-repos.sh

ENV HOME=/home/opencode
ENV OPENCODE_PORT=4096

EXPOSE 4096

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint.sh"]
