#!/usr/bin/env bash
# Read one ECR tag. Only ImageNotFound is optional; AWS and response errors fail.
set -euo pipefail
REPOSITORY="${1:?repository required}"
TAG="${2:?tag required}"
ALLOW_MISSING="${3:-}"
if [ -n "$ALLOW_MISSING" ] && [ "$ALLOW_MISSING" != '--allow-missing' ]; then
  echo 'ERROR: expected --allow-missing or no third argument' >&2
  exit 1
fi
export AWS_PAGER=''
aws ecr batch-get-image --repository-name "$REPOSITORY" --image-ids imageTag="$TAG" --output json |
  ALLOW_MISSING="$ALLOW_MISSING" python3 -c '
import json, os, re, sys
response = json.load(sys.stdin)
images, failures = response["images"], response["failures"]
if failures:
    if not images and len(failures) == 1 and failures[0]["failureCode"] == "ImageNotFound" and os.environ["ALLOW_MISSING"]:
        print("")
        sys.exit(0)
    raise SystemExit("ERROR: ECR image lookup failed: " + ", ".join(f["failureCode"] for f in failures))
if len(images) != 1:
    raise SystemExit("ERROR: expected exactly one ECR image")
digest = images[0]["imageId"]["imageDigest"]
if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
    raise SystemExit("ERROR: invalid ECR image digest")
print(digest)
'
