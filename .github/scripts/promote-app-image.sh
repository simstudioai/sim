#!/usr/bin/env bash
# Capture the cutover lower bound at the app tag move, after the image is built.
set -euo pipefail
REGISTRY="${1:?registry required}"
REPOSITORY="${2:?repository required}"
SOURCE_TAG="${3:?source tag required}"
DEPLOY_TAG="${4:?deploy tag required}"
RELEASE_TAG="${5:-}"
: "${GITHUB_OUTPUT:?GitHub output file required}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREVIOUS=$(bash "$SCRIPT_DIR/get-ecr-image-digest.sh" "$REPOSITORY" "$DEPLOY_TAG" --allow-missing)
# A tag read straight after the move can still return the previous image, which
# reports a moved tag as unchanged. The dry run prints the exact manifest the
# move pushes (plus a trailing newline), so its hash is the digest the tag will
# point at, known before the move.
MANIFEST=$(docker buildx imagetools create --dry-run -t "$REGISTRY/$REPOSITORY:$DEPLOY_TAG" "$REGISTRY/$REPOSITORY:$SOURCE_TAG")
DIGEST="sha256:$(printf '%s' "$MANIFEST" | sha256sum | cut -d' ' -f1)"
EPOCH=$(date +%s)
bash "$SCRIPT_DIR/promote-image.sh" "$REGISTRY" "$REPOSITORY" "$SOURCE_TAG" "$DEPLOY_TAG" "$RELEASE_TAG"
for attempt in $(seq 1 20); do
  [ "$(bash "$SCRIPT_DIR/get-ecr-image-digest.sh" "$REPOSITORY" "$DEPLOY_TAG" --allow-missing)" = "$DIGEST" ] && break
  if [ "$attempt" -eq 20 ]; then
    echo "ERROR: $DEPLOY_TAG never resolved to the pushed $DIGEST; cutover cannot be correlated" >&2
    exit 1
  fi
  sleep 3
done
CHANGED=true
if [ "$DIGEST" = "$PREVIOUS" ]; then CHANGED=false; fi
{
  echo "retag_epoch=$EPOCH"
  echo "app_image_digest=$DIGEST"
  echo "app_image_changed=$CHANGED"
} >> "$GITHUB_OUTPUT"
