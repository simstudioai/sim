# ========================================
# Combined Presidio service (analyzer + anonymizer) on a single port (5001)
#
# ONE image serves both NER engines — the engine is a pure runtime choice via
# PII_ENGINE (spacy default | gliner). spaCy large models, torch (CPU), the
# gliner package, and the baked GLiNER weights all ship in it, so flipping
# engines never requires an image swap.
#
# GPU variant (EC2-GPU fleet follow-up): same Dockerfile, CUDA torch wheels —
#   docker build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128 ...
# (torch CUDA wheels bundle their own CUDA libs; the host only needs the
# nvidia container runtime.)
#
# Source files are COPY'd last so code edits never re-download deps or models.
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

# --- GLiNER engine deps -------------------------------------------------------
# torch is pinned here (not requirements-gliner.txt) because the CPU and CUDA
# builds install the same version from different wheel indexes. 2.11.0 is the
# newest release published on both the cpu and cu128 indexes for py312.
ARG TORCH_VERSION=2.11.0
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch==${TORCH_VERSION} --index-url ${TORCH_INDEX_URL}

COPY apps/pii/requirements-gliner.txt ./requirements-gliner.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements-gliner.txt

# Small spaCy models (~60MB total) give the gliner engine tokenization +
# lemmas for the regex recognizers; GLiNER does the NER (see engines.py).
ARG SPACY_SM_MODELS="en_core_web_sm-3.8.0 es_core_news_sm-3.8.0 it_core_news_sm-3.8.0 pl_core_news_sm-3.8.0 fi_core_news_sm-3.8.0"
RUN --mount=type=cache,target=/root/.cache/pip \
    for model in ${SPACY_SM_MODELS}; do \
      whl="${model}-py3-none-any.whl"; \
      curl -fL --retry 5 --retry-delay 5 --retry-all-errors -C - \
        -o "/tmp/${whl}" \
        "https://github.com/explosion/spacy-models/releases/download/${model}/${whl}" || exit 1; \
    done && \
    pip install /tmp/*.whl && \
    rm /tmp/*.whl

# Bake the GLiNER weights at build time (cached layer) so startup never
# touches the network. HF_HUB_OFFLINE makes a missing/overridden
# PII_GLINER_MODEL fail fast at startup instead of silently downloading.
ENV HF_HOME=/opt/hf-cache
ARG GLINER_MODEL=urchade/gliner_multi_pii-v1
RUN python -c "from gliner import GLiNER; GLiNER.from_pretrained('${GLINER_MODEL}')" && \
    chmod -R a+rX /opt/hf-cache
ENV HF_HUB_OFFLINE=1

# pytest/httpx for the in-image test suites (tests/) — baked in because the
# runtime user has no writable HOME for pip install --user.
COPY apps/pii/requirements-dev.txt ./requirements-dev.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements-dev.txt

RUN groupadd -g 1001 pii && \
    useradd -u 1001 -g pii pii && \
    chown -R pii:pii /app

COPY --chown=pii:pii apps/pii/server.py apps/pii/engines.py ./
COPY --chown=pii:pii apps/pii/scripts ./scripts
COPY --chown=pii:pii apps/pii/tests ./tests

USER pii

# Listen on 5001. Runs as its own ECS service (separate task), reached via PII_URL;
# 5001 avoids colliding with the app's 3000 in local/compose runs on one host.
EXPOSE 5001

# start-period covers the model cold start. With PII_WORKERS>1 each worker loads
# the five spaCy models independently and in parallel, so allow generous headroom
# (memory-bandwidth contention stretches the wall-time beyond the single-worker case).
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD curl -fsS http://localhost:5001/health || exit 1

# Worker count is env-driven so ONE image scales per task size: set PII_WORKERS to
# the task's vCPU count (each worker loads the models independently, ~3 GB each, so
# size task memory ≈ PII_WORKERS × 3 GB + overhead). Defaults to 1 for local/small.
# `sh -c exec` expands the env var while keeping uvicorn as PID 1 for clean SIGTERM.
# Quote the expansion so a malformed PII_WORKERS fails uvicorn arg-parsing rather
# than being interpreted by the shell.
# NB for the gliner engine: EACH worker loads its own GLiNER model copy (into GPU
# memory when on cuda), so GPU deployments generally want PII_WORKERS=1 per GPU.
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port 5001 --workers \"${PII_WORKERS:-1}\""]
