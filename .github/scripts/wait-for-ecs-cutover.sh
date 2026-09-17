#!/usr/bin/env bash
# Resolve a pushed app digest to CodePipeline -> CodeDeploy -> every ECS target's
# AllowTraffic event. An unchanged tag uses since-epoch=0 to verify the latest
# pipeline execution instead of assuming the tagged image is already serving.
# Usage: wait-for-ecs-cutover.sh <pipeline-name> <image-digest> <since-epoch>
set -euo pipefail

PIPELINE="${1:?pipeline name required}"
DIGEST="${2:?image digest required}"
SINCE_EPOCH="${3:?since-epoch required}"
POLL_INTERVAL="${POLL_INTERVAL:-15}"
OVERALL_TIMEOUT="${OVERALL_TIMEOUT:-4200}"
if ! [[ "$PIPELINE" =~ ^[A-Za-z0-9.@_-]+$ && "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ && "$SINCE_EPOCH" =~ ^[0-9]+$ && "$POLL_INTERVAL" =~ ^[1-9][0-9]*$ && "$OVERALL_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo 'ERROR: invalid pipeline, digest, epoch, or polling budget' >&2
  exit 1
fi
export AWS_PAGER=''
export AWS_RETRY_MODE=standard
export AWS_MAX_ATTEMPTS=3

deadline=$(( $(date +%s) + OVERALL_TIMEOUT ))
log() { echo "[wait-for-ecs-cutover] $*"; }
check_deadline() {
  if [ "$(date +%s)" -ge "$deadline" ]; then
    log "ERROR: timed out after ${OVERALL_TIMEOUT}s waiting for $1"
    exit 1
  fi
}
aws_read() {
  aws --cli-connect-timeout 10 --cli-read-timeout 30 "$@"
}

find_execution() {
  local executions
  executions=$(aws_read codepipeline list-pipeline-executions \
    --pipeline-name "$PIPELINE" --max-items 30 \
    --query 'pipelineExecutionSummaries' --output json)
  printf '%s\n' "$executions" | SINCE="$SINCE_EPOCH" DIGEST="$DIGEST" python3 -c '
import datetime, json, os, sys
since = int(os.environ["SINCE"])
def epoch(execution):
    value = execution["startTime"]
    if isinstance(value, (int, float)):
        return value
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
def matches(execution):
    return any(r["actionName"] == "ECR_Source" and r.get("revisionId") == os.environ["DIGEST"] for r in execution.get("sourceRevisions", []))
executions = sorted(json.load(sys.stdin), key=epoch, reverse=True)
if since == 0:
    if not executions or not matches(executions[0]):
        raise SystemExit("ERROR: unchanged app tag does not match the latest pipeline execution; cutover is unverified")
    selected = executions[0]
else:
    selected = executions[0] if executions and epoch(executions[0]) >= since else None
    if selected and not matches(selected):
        raise SystemExit("ERROR: latest pipeline execution does not match this app digest; deployment was superseded or its source is unverified")
print(selected["pipelineExecutionId"] if selected else "")
'
}

EXECUTION_ID=''
while [ -z "$EXECUTION_ID" ]; do
  check_deadline 'the matching pipeline execution'
  EXECUTION_ID=$(find_execution)
  if [ -z "$EXECUTION_ID" ]; then
    log 'No matching execution since this push; waiting'
    sleep "$POLL_INTERVAL"
  fi
done
log "Matched pipeline execution: $EXECUTION_ID"

DEPLOYMENT_ID=''
while [ -z "$DEPLOYMENT_ID" ] || [ "$DEPLOYMENT_ID" = 'None' ]; do
  check_deadline 'the CodeDeploy deployment (the Deploy stage may be queued)'
  status=$(aws_read codepipeline get-pipeline-execution \
    --pipeline-name "$PIPELINE" --pipeline-execution-id "$EXECUTION_ID" \
    --query 'pipelineExecution.status' --output text)
  case "$status" in
    Failed|Stopped|Stopping|Superseded|Cancelled)
      log "ERROR: pipeline execution ended in $status; not promoting"; exit 1 ;;
    InProgress|Succeeded) ;;
    *) log "ERROR: unexpected pipeline status: $status"; exit 1 ;;
  esac
  # Action history does not publish the external deployment ID until cleanup
  # finishes. Live state exposes it while traffic is shifting. Correlate both
  # the stage execution and action attempt so old state cannot satisfy this run.
  deploy_state=$(aws_read codepipeline get-pipeline-state --name "$PIPELINE" \
    --query "stageStates[?stageName=='Deploy'] | [0]" --output json)
  deploy_actions=$(aws_read codepipeline list-action-executions \
    --pipeline-name "$PIPELINE" --filter pipelineExecutionId="$EXECUTION_ID" \
    --query "actionExecutionDetails[?stageName=='Deploy']" --output json)
  DEPLOYMENT_ID=$(printf '%s\n' "$deploy_actions" | DEPLOY_STATE="$deploy_state" EXECUTION_ID="$EXECUTION_ID" python3 -c '
import json, os, re, sys
state = json.loads(os.environ["DEPLOY_STATE"])
actions = json.load(sys.stdin)
if not state or state.get("latestExecution", {}).get("pipelineExecutionId") != os.environ["EXECUTION_ID"] or not actions:
    print("")
    sys.exit(0)
if len({a["actionName"] for a in actions}) != 1:
    raise SystemExit("ERROR: expected one Deploy action in the app pipeline")
latest = max(actions, key=lambda a: a["startTime"])
matches = [a["latestExecution"] for a in state.get("actionStates", [])
           if a["actionName"] == latest["actionName"]
           and a.get("latestExecution", {}).get("actionExecutionId") == latest["actionExecutionId"]]
if len(matches) > 1:
    raise SystemExit("ERROR: ambiguous live Deploy action")
if not matches:
    print("")
    sys.exit(0)
if latest["status"] not in ("InProgress", "Succeeded"):
    raise SystemExit("ERROR: Deploy action ended in " + latest["status"])
deployment_id = matches[0].get("externalExecutionId", "")
if deployment_id and not re.fullmatch(r"d-[A-Za-z0-9]+", deployment_id):
    raise SystemExit("ERROR: invalid CodeDeploy deployment ID in pipeline state")
print(deployment_id)
')
  if [ -z "$DEPLOYMENT_ID" ] || [ "$DEPLOYMENT_ID" = 'None' ]; then
    if [ "$status" = 'Succeeded' ]; then
      log 'ERROR: successful pipeline has no CodeDeploy deployment'; exit 1
    fi
    sleep "$POLL_INTERVAL"
  fi
done
log "CodeDeploy deployment: $DEPLOYMENT_ID"

while true; do
  check_deadline 'AllowTraffic on every ECS target'
  status=$(aws_read deploy get-deployment --deployment-id "$DEPLOYMENT_ID" \
    --query 'deploymentInfo.status' --output text)
  case "$status" in
    Failed|Stopped) log "ERROR: deployment ended in $status; not promoting"; exit 1 ;;
    Created|Queued|InProgress|Baking|Ready|Succeeded) ;;
    *) log "ERROR: unexpected deployment status: $status"; exit 1 ;;
  esac
  target_ids=$(aws_read deploy list-deployment-targets --deployment-id "$DEPLOYMENT_ID" \
    --query 'targetIds' --output text)
  if [ -n "$target_ids" ] && [ "$target_ids" != 'None' ]; then
    all_ok=1
    for target in $target_ids; do
      cutover=$(aws_read deploy get-deployment-target --deployment-id "$DEPLOYMENT_ID" --target-id "$target" \
        --query "deploymentTarget.ecsTarget.lifecycleEvents[?lifecycleEventName=='AllowTraffic'].status | [0]" \
        --output text)
      case "$cutover" in
        Succeeded) ;;
        Failed|Skipped|Unknown) log "ERROR: target $target cutover status $cutover"; exit 1 ;;
        Pending|InProgress|None|'') all_ok=0 ;;
        *) log "ERROR: unexpected cutover status: $cutover"; exit 1 ;;
      esac
    done
    if [ "$all_ok" = 1 ]; then
      LATEST_EXECUTION_ID=$(find_execution)
      if [ "$LATEST_EXECUTION_ID" != "$EXECUTION_ID" ]; then
        log 'ERROR: a newer pipeline execution appeared during cutover; not promoting'
        exit 1
      fi
      log 'Traffic cutover complete on every ECS target'
      exit 0
    fi
  fi
  log 'Traffic cutover is not complete; waiting'
  sleep "$POLL_INTERVAL"
done
