# ========================================
# Combined Presidio service (analyzer + anonymizer) on a single port (5001)
# ========================================
FROM python:3.12-slim-bookworm AS base

WORKDIR /app

# build-essential for any sdist that compiles native deps (e.g. blis/thinc).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned Python deps. Separate layer so source edits don't reinstall them.
COPY apps/pii/requirements.txt ./requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Pinned spaCy models (en + es/it/pl/fi, ~2.2GB total). Downloaded with
# retries/resume — the large wheels truncate on flaky networks if pip fetches
# the URLs directly.
ARG SPACY_MODELS="en_core_web_lg-3.8.0 es_core_news_lg-3.8.0 it_core_news_lg-3.8.0 pl_core_news_lg-3.8.0 fi_core_news_lg-3.8.0"
RUN --mount=type=cache,target=/root/.cache/pip \
    for model in ${SPACY_MODELS}; do \
      whl="${model}-py3-none-any.whl"; \
      curl -fL --retry 5 --retry-delay 5 --retry-all-errors -C - \
        -o "/tmp/${whl}" \
        "https://github.com/explosion/spacy-models/releases/download/${model}/${whl}" || exit 1; \
    done && \
    pip install /tmp/*.whl && \
    rm /tmp/*.whl

COPY apps/pii/server.py ./server.py

RUN groupadd -g 1001 pii && \
    useradd -u 1001 -g pii pii && \
    chown -R pii:pii /app
USER pii

# Listen on 5001. Runs as its own ECS service (separate task), reached via PII_URL;
# 5001 avoids colliding with the app's 3000 in local/compose runs on one host.
EXPOSE 5001

# start-period is generous: five large spaCy models load at import before
# /health responds. Tune against measured cold-start once built.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD curl -fsS http://localhost:5001/health || exit 1

# Worker count is env-driven so ONE image scales per task size: set PII_WORKERS to
# the task's vCPU count (each worker loads the models independently, ~3 GB each, so
# size task memory ≈ PII_WORKERS × 3 GB + overhead). Defaults to 1 for local/small.
# `sh -c exec` expands the env var while keeping uvicorn as PID 1 for clean SIGTERM.
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port 5001 --workers ${PII_WORKERS:-1}"]
