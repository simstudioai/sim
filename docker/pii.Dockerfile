# ========================================
# Combined Presidio service (analyzer + anonymizer) on a single port (3000)
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

# Listen on 5001. In the ECS task all containers share one network namespace
# (awsvpc) and the app owns 3000, so this sidecar must not use 3000.
EXPOSE 5001

# start-period is generous: five large spaCy models load at import before
# /health responds. Tune against measured cold-start once built.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD curl -fsS http://localhost:5001/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5001"]
