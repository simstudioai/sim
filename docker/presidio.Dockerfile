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

# Pinned deps + pinned en_core_web_lg wheel. Separate layer so source edits
# don't reinstall the heavy model.
COPY docker/presidio/requirements.txt ./requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Pinned English spaCy model. Downloaded with retries/resume (the wheel is
# ~400MB and truncates on flaky networks if pip fetches the URL directly).
ARG SPACY_MODEL_VERSION=3.8.0
RUN --mount=type=cache,target=/root/.cache/pip \
    MODEL_WHL="en_core_web_lg-${SPACY_MODEL_VERSION}-py3-none-any.whl" && \
    curl -fL --retry 5 --retry-delay 5 --retry-all-errors -C - \
      -o "/tmp/${MODEL_WHL}" \
      "https://github.com/explosion/spacy-models/releases/download/en_core_web_lg-${SPACY_MODEL_VERSION}/${MODEL_WHL}" && \
    pip install --no-cache-dir "/tmp/${MODEL_WHL}" && \
    rm "/tmp/${MODEL_WHL}"

COPY docker/presidio/server.py ./server.py

RUN groupadd -g 1001 presidio && \
    useradd -u 1001 -g presidio presidio && \
    chown -R presidio:presidio /app
USER presidio

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:3000/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "3000"]
