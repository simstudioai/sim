#!/usr/bin/env bash
# Capture the cutover lower bound at the app tag move, after the image is built.
set -euo pipefail
REGISTRY="${1:?registry required}"
REPOSITORY="${2:?repository required}"
SOURCE_TAG="${3:?source tag required}"
DEPLOY_TAG="${4:?deploy tag required}"
: "${GITHUB_OUTPUT:?GitHub output file required}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREVIOUS=$(bash "$SCRIPT_DIR/get-ecr-image-digest.sh" "$REPOSITORY" "$DEPLOY_TAG" --allow-missing)
EPOCH=$(date +%s)
docker buildx imagetools create -t "$REGISTRY/$REPOSITORY:$DEPLOY_TAG" "$REGISTRY/$REPOSITORY:$SOURCE_TAG"
DIGEST=$(bash "$SCRIPT_DIR/get-ecr-image-digest.sh" "$REPOSITORY" "$DEPLOY_TAG")
CHANGED=true
if [ "$DIGEST" = "$PREVIOUS" ]; then CHANGED=false; fi
{
  echo "retag_epoch=$EPOCH"
  echo "app_image_digest=$DIGEST"
  echo "app_image_changed=$CHANGED"
} >> "$GITHUB_OUTPUT"
