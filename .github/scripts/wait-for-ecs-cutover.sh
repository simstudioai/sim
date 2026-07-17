#!/usr/bin/env bash
# Waits for the ECS blue/green deploy triggered by a specific app image push to
# reach its traffic cutover (CodeDeploy AllowTraffic == Succeeded), then exits 0.
#
# ECR app images use a floating tag (latest/staging) with no git SHA, so the
# only durable key linking this CI push to its ECS deploy is the image DIGEST.
# Correlation: image digest -> CodePipeline execution (AppEcrImage revision) ->
# Deploy action externalExecutionId (== CodeDeploy deployment id) -> AllowTraffic.
#
# Usage: wait-for-ecs-cutover.sh <pipeline-name> <image-digest>
# Requires: awscli v2, configured credentials with codedeploy + codepipeline read.
set -euo pipefail

PIPELINE="${1:?pipeline name required}"
DIGEST="${2:?image digest required}"

POLL_INTERVAL="${POLL_INTERVAL:-15}"
# 70 min covers a prod deploy whose Deploy stage is queued behind a prior
# deploy's ~50-min termination bake before its own traffic shift begins.
OVERALL_TIMEOUT="${OVERALL_TIMEOUT:-4200}"

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

# Phase A: find the pipeline execution whose ECR source revision matches our
# digest. --max-items bounds the fetch (the CLI otherwise auto-paginates the whole
# execution history); our push is the newest execution, so it's on the first page.
# The revisionId match is done server-side via JMESPath; grep isolates the UUID
# from any trailing pagination-token line in text output.
EXECUTION_ID=""
while [ -z "$EXECUTION_ID" ]; do
  fail_if_expired "pipeline execution matching digest"
  EXECUTION_ID=$(aws codepipeline list-pipeline-executions \
        --pipeline-name "$PIPELINE" --max-items 30 \
        --query "pipelineExecutionSummaries[?sourceRevisions[?actionName=='ECR_Source' && revisionId=='$DIGEST']].pipelineExecutionId" \
        --output text 2>/dev/null | tr '\t ' '\n\n' | grep -Em1 '^[0-9a-f-]{36}$' || true)
  if [ -z "$EXECUTION_ID" ]; then
    log "No matching pipeline execution yet; retry in ${POLL_INTERVAL}s (remaining $(remaining)s)"
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

# Phase C: wait for the traffic cutover (AllowTraffic lifecycle event Succeeded).
while true; do
  fail_if_expired "AllowTraffic (traffic cutover)"
  dstatus=$(aws deploy get-deployment --deployment-id "$DEPLOYMENT_ID" \
        --query 'deploymentInfo.status' --output text 2>/dev/null || true)
  case "$dstatus" in
    Failed|Stopped)
      log "ERROR: CodeDeploy deployment $DEPLOYMENT_ID ended in status $dstatus; not promoting"
      exit 1
      ;;
  esac
  target_id=$(aws deploy list-deployment-targets --deployment-id "$DEPLOYMENT_ID" \
        --query 'targetIds[0]' --output text 2>/dev/null || true)
  at_status=""
  if [ -n "$target_id" ] && [ "$target_id" != "None" ]; then
    at_status=$(aws deploy get-deployment-target --deployment-id "$DEPLOYMENT_ID" --target-id "$target_id" \
          --query "deploymentTarget.ecsTarget.lifecycleEvents[?lifecycleEventName=='AllowTraffic'].status | [0]" \
          --output text 2>/dev/null || true)
    if [ "$at_status" = "Succeeded" ]; then
      log "Traffic cutover complete (AllowTraffic Succeeded) for $DEPLOYMENT_ID"
      exit 0
    fi
  fi
  log "Deployment $DEPLOYMENT_ID status=$dstatus AllowTraffic=${at_status:-pending}; wait ${POLL_INTERVAL}s (remaining $(remaining)s)"
  sleep "$POLL_INTERVAL"
done
