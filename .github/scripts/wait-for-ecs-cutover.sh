#!/usr/bin/env bash
# Waits for the ECS blue/green deploy triggered by a specific app image push to
# reach its traffic cutover (CodeDeploy AllowTraffic == Succeeded on every ECS
# target), then exits 0.
#
# ECR app images use a floating tag (latest/staging) with no git SHA, so the
# only durable key linking this CI push to its ECS deploy is the image DIGEST.
# Correlation: image digest -> CodePipeline execution (ECR_Source revision) ->
# Deploy action externalExecutionId (== CodeDeploy deployment id) -> AllowTraffic.
#
# The digest alone is ambiguous: a prior run with the same image could match an
# older, already-cutover execution and promote too early. SINCE_EPOCH (the time
# the deploy tag was retagged, i.e. when THIS push's pipeline was triggered)
# disambiguates — only an execution that started at/after the retag is ours.
#
# Usage: wait-for-ecs-cutover.sh <pipeline-name> <image-digest> <since-epoch>
# Requires: awscli v2, python3, credentials with codedeploy + codepipeline read.
set -euo pipefail

PIPELINE="${1:?pipeline name required}"
DIGEST="${2:?image digest required}"
SINCE_EPOCH="${3:?since-epoch (retag time) required}"

POLL_INTERVAL="${POLL_INTERVAL:-15}"
# 70 min covers a prod deploy whose Deploy stage is queued behind a prior
# deploy's ~50-min termination bake before its own traffic shift begins.
OVERALL_TIMEOUT="${OVERALL_TIMEOUT:-4200}"
# Tolerate minor clock skew between the runner (retag time) and CodePipeline.
SINCE_SKEW="${SINCE_SKEW:-120}"

deadline=$(( $(date +%s) + OVERALL_TIMEOUT ))
remaining() { echo $(( deadline - $(date +%s) )); }
log() { echo "[wait-for-ecs-cutover] $*"; }
fail_if_expired() {
  if [ "$(remaining)" -le 0 ]; then
    log "ERROR: timed out after ${OVERALL_TIMEOUT}s waiting for: $1"
    exit 1
  fi
}

log "Pipeline: $PIPELINE"
log "Target app image digest: $DIGEST"
log "Requiring execution started at/after epoch $SINCE_EPOCH (minus ${SINCE_SKEW}s skew)"

# Phase A: find the newest pipeline execution whose ECR source revision matches
# our digest AND that started at/after the retag. The since filter rejects a
# stale historical execution reusing the same digest. --max-items bounds the
# fetch (the CLI otherwise auto-paginates the whole history).
EXECUTION_ID=""
while [ -z "$EXECUTION_ID" ]; do
  fail_if_expired "pipeline execution matching digest since retag"
  matches=$(aws codepipeline list-pipeline-executions \
        --pipeline-name "$PIPELINE" --max-items 30 \
        --query "pipelineExecutionSummaries[?sourceRevisions[?actionName=='ECR_Source' && revisionId=='$DIGEST']].[startTime, pipelineExecutionId]" \
        --output text 2>/dev/null || true)
  EXECUTION_ID=$(printf '%s\n' "$matches" | SINCE="$SINCE_EPOCH" SKEW="$SINCE_SKEW" python3 -c '
import sys, os, datetime
since = float(os.environ["SINCE"]) - float(os.environ["SKEW"])
best_epoch = None
best_id = None
for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 2:
        continue
    ts, eid = parts[0].strip(), parts[1].strip()
    if not ts or not eid or "-" not in eid:
        continue
    try:
        epoch = float(ts)
    except ValueError:
        try:
            epoch = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
    if epoch >= since and (best_epoch is None or epoch > best_epoch):
        best_epoch, best_id = epoch, eid
print(best_id or "")
' 2>/dev/null || true)
  if [ -z "$EXECUTION_ID" ]; then
    log "No matching post-retag pipeline execution yet; retry in ${POLL_INTERVAL}s (remaining $(remaining)s)"
    sleep "$POLL_INTERVAL"
  fi
done
log "Matched pipeline execution: $EXECUTION_ID"

# Phase B: resolve the CodeDeploy deployment id from the Deploy action. This may
# stay empty for a while if the Deploy stage is queued behind a prior deploy.
DEPLOYMENT_ID=""
while [ -z "$DEPLOYMENT_ID" ] || [ "$DEPLOYMENT_ID" = "None" ]; do
  fail_if_expired "CodeDeploy deployment id (Deploy stage may be queued behind a prior deploy's bake)"
  status=$(aws codepipeline get-pipeline-execution \
        --pipeline-name "$PIPELINE" --pipeline-execution-id "$EXECUTION_ID" \
        --query 'pipelineExecution.status' --output text 2>/dev/null || true)
  case "$status" in
    Failed|Stopped|Superseded)
      log "ERROR: pipeline execution $EXECUTION_ID ended in status $status before deploy"
      exit 1
      ;;
  esac
  DEPLOYMENT_ID=$(aws codepipeline list-action-executions \
        --pipeline-name "$PIPELINE" \
        --filter pipelineExecutionId="$EXECUTION_ID" \
        --query "actionExecutionDetails[?stageName=='Deploy'].output.executionResult.externalExecutionId | [0]" \
        --output text 2>/dev/null || true)
  if [ -z "$DEPLOYMENT_ID" ] || [ "$DEPLOYMENT_ID" = "None" ]; then
    log "Deploy stage not started yet (pipeline status: $status); retry in ${POLL_INTERVAL}s (remaining $(remaining)s)"
    sleep "$POLL_INTERVAL"
  fi
done
log "CodeDeploy deployment: $DEPLOYMENT_ID"

# Phase C: wait for the traffic cutover. Require AllowTraffic == Succeeded on
# EVERY ECS target, so a multi-target deploy can't promote while one target is
# still mid-cutover or failed.
while true; do
  fail_if_expired "AllowTraffic (traffic cutover) on all targets"
  dstatus=$(aws deploy get-deployment --deployment-id "$DEPLOYMENT_ID" \
        --query 'deploymentInfo.status' --output text 2>/dev/null || true)
  case "$dstatus" in
    Failed|Stopped)
      log "ERROR: CodeDeploy deployment $DEPLOYMENT_ID ended in status $dstatus; not promoting"
      exit 1
      ;;
  esac
  target_ids=$(aws deploy list-deployment-targets --deployment-id "$DEPLOYMENT_ID" \
        --query 'targetIds' --output text 2>/dev/null || true)
  if [ -n "$target_ids" ] && [ "$target_ids" != "None" ]; then
    all_ok=1
    ntargets=0
    for tid in $target_ids; do
      ntargets=$((ntargets + 1))
      at_status=$(aws deploy get-deployment-target --deployment-id "$DEPLOYMENT_ID" --target-id "$tid" \
            --query "deploymentTarget.ecsTarget.lifecycleEvents[?lifecycleEventName=='AllowTraffic'].status | [0]" \
            --output text 2>/dev/null || true)
      if [ "$at_status" != "Succeeded" ]; then
        all_ok=0
      fi
    done
    if [ "$ntargets" -gt 0 ] && [ "$all_ok" = "1" ]; then
      log "Traffic cutover complete (AllowTraffic Succeeded on all $ntargets target(s)) for $DEPLOYMENT_ID"
      exit 0
    fi
  fi
  log "Deployment $DEPLOYMENT_ID status=$dstatus; not all targets past AllowTraffic; wait ${POLL_INTERVAL}s (remaining $(remaining)s)"
  sleep "$POLL_INTERVAL"
done
