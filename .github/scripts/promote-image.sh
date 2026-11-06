#!/usr/bin/env bash
# Point a deploy tag (and, for production, its release-<sha> alias) at a built image.
# One imagetools call writes both tags, so they always share one list digest.
set -euo pipefail
REGISTRY="${1:?registry required}"
REPOSITORY="${2:?repository required}"
SOURCE_TAG="${3:?source tag required}"
DEPLOY_TAG="${4:?deploy tag required}"
RELEASE_TAG="${5:-}"
TAG_ARGS=(-t "$REGISTRY/$REPOSITORY:$DEPLOY_TAG")
if [ -n "$RELEASE_TAG" ]; then TAG_ARGS+=(-t "$REGISTRY/$REPOSITORY:$RELEASE_TAG"); fi
docker buildx imagetools create "${TAG_ARGS[@]}" "$REGISTRY/$REPOSITORY:$SOURCE_TAG"
