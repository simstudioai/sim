#!/usr/bin/env bash
# Disposable stack for scripts/test-chat-steering-e2e.ts: Postgres and Redis containers, the real
# Mothership worker from a local checkout, and `next dev` for this app. The test itself owns the
# fake model and a recording proxy between the app and the worker.
#
# Usage: chat-steering-e2e.sh <run|up|test|down>
#   run   up, then the test, then down. Exits with the test's status.
#   up    leaves the stack running, for iterating on the test.
#   test  runs the test against a stack that is up. CHAT_STEERING_E2E_ONLY=1,7 picks checks.
#   down  stops every process and removes every container this stack started.
#
# Required: MOTHERSHIP_WORKER_ROOT (the worker/ directory of a mothership checkout) and
# CHAT_STEERING_E2E_REPORT_PATH. Every child gets a scrubbed environment, so no shell-exported
# provider key or database URL reaches it; the worker's only Anthropic key is a placeholder and its
# base URL is the test's fake model.
set -euo pipefail

command=${1:?usage: chat-steering-e2e.sh <run|up|test|down>}
worker_root=${MOTHERSHIP_WORKER_ROOT:?set MOTHERSHIP_WORKER_ROOT to a mothership worker/ directory}
report_path=${CHAT_STEERING_E2E_REPORT_PATH:?set CHAT_STEERING_E2E_REPORT_PATH}

app_dir=$(cd "$(dirname "$0")/.." && pwd)
db_dir=$(cd "$app_dir/../../packages/db" && pwd)
state_dir=${CHAT_STEERING_E2E_STATE_DIR:-${TMPDIR:-/tmp}/chat-steering-e2e}
mkdir -p "$state_dir"

pg_port=${CHAT_STEERING_E2E_PG_PORT:-55491}
redis_port=${CHAT_STEERING_E2E_REDIS_PORT:-56391}
app_port=${CHAT_STEERING_E2E_APP_PORT:-3471}
worker_port=${CHAT_STEERING_E2E_WORKER_PORT:-3472}
proxy_port=${CHAT_STEERING_E2E_PROXY_PORT:-3473}
model_port=${CHAT_STEERING_E2E_MODEL_PORT:-3474}

pg_name=chat-steering-e2e-pg-$pg_port
redis_name=chat-steering-e2e-redis-$redis_port
app_url=http://127.0.0.1:$app_port
database_url=postgresql://postgres:postgres@127.0.0.1:$pg_port/chat_steering_test
worker_database_url=postgresql://postgres:postgres@127.0.0.1:$pg_port/chat_steering_worker_test
redis_url=redis://127.0.0.1:$redis_port
auth_secret=chat-steering-e2e-secret-at-least-32-characters
internal_secret=chat-steering-e2e-internal-secret-at-least-32
copilot_key=chat-steering-e2e-copilot-key

scrubbed() {
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" "$@"
}

stop_group() {
  local pid_file=$state_dir/$1.pid
  [ -f "$pid_file" ] || return 0
  local pid
  pid=$(cat "$pid_file")
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 -- "-$pid" 2>/dev/null || break
    sleep 0.25
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
  rm -f "$pid_file"
}

down() {
  stop_group app
  stop_group worker
  docker rm -f "$pg_name" "$redis_name" >/dev/null 2>&1 || true
}

wait_for() {
  local label=$1 url=$2 pid_file=$3 seconds=$4
  for _ in $(seq 1 "$seconds"); do
    if curl -fsS -o /dev/null --max-time 5 "$url"; then return 0; fi
    if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "$label exited before it became ready; see $state_dir" >&2
      return 1
    fi
    sleep 1
  done
  echo "$label was not ready after ${seconds}s; see $state_dir" >&2
  return 1
}

up() {
  docker run -d --rm --name "$pg_name" -e POSTGRES_PASSWORD=postgres \
    -p "127.0.0.1:$pg_port:5432" pgvector/pgvector:pg17 -c max_connections=200 >/dev/null
  docker run -d --rm --name "$redis_name" -p "127.0.0.1:$redis_port:6379" redis:7-alpine >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$pg_name" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$pg_name" psql -U postgres -c 'CREATE DATABASE chat_steering_test' >/dev/null
  docker exec "$pg_name" psql -U postgres -c 'CREATE DATABASE chat_steering_worker_test' >/dev/null
  docker exec "$pg_name" psql -U postgres -d chat_steering_test \
    -c 'CREATE EXTENSION vector' -c 'CREATE EXTENSION btree_gin' -c 'CREATE EXTENSION pg_trgm' >/dev/null

  (cd "$db_dir" && scrubbed DATABASE_URL="$database_url" bun --no-env-file ./scripts/migrate.ts) \
    >"$state_dir/migrate-sim.log" 2>&1
  (cd "$worker_root" && scrubbed DATABASE_URL="$worker_database_url" \
    bun --no-env-file packages/db/scripts/migrate.ts) >"$state_dir/migrate-worker.log" 2>&1

  # Job control gives each background child its own process group, which is what stop_group signals.
  set -m
  (
    cd "$worker_root"
    exec nice -n 15 env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      PORT="$worker_port" \
      DATABASE_URL="$worker_database_url" \
      REDIS_URL="$redis_url" \
      SIM_ENDPOINT="$app_url" \
      INTERNAL_API_SECRET="$internal_secret" \
      COPILOT_INBOUND_API_KEY="$copilot_key" \
      ANTHROPIC_API_KEY=fake-model-key-never-sent-to-a-provider \
      COPILOT_ANTHROPIC_PROVIDER=anthropic \
      COPILOT_ANTHROPIC_BASE_URL="http://127.0.0.1:$model_port/v1" \
      COPILOT_MODEL=claude-opus-5-5 \
      COPILOT_SUBAGENT_MODEL=claude-opus-5-5 \
      COPILOT_TITLE_MODEL=claude-haiku-5-5 \
      COPILOT_CONDENSER_MODEL=claude-haiku-5-5 \
      COPILOT_SEARCH_MODEL=claude-opus-5-5 \
      COPILOT_SHUTDOWN_HANDOFF_MS=1000 \
      OTEL_EXPORTER_OTLP_ENDPOINT= \
      bun --no-env-file apps/server/src/index.ts
  ) >"$state_dir/worker.log" 2>&1 &
  echo $! >"$state_dir/worker.pid"
  wait_for worker "http://127.0.0.1:$worker_port/health" "$state_dir/worker.pid" 60

  rm -rf "$app_dir/.next/dev"
  (
    cd "$app_dir"
    exec nice -n 15 env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
      NODE_OPTIONS=--max-old-space-size=8192 \
      NEXT_TELEMETRY_DISABLED=1 DISABLE_TELEMETRY=true \
      DATABASE_URL="$database_url" \
      REDIS_URL="$redis_url" \
      BETTER_AUTH_SECRET="$auth_secret" \
      BETTER_AUTH_URL="$app_url" \
      NEXT_PUBLIC_APP_URL="$app_url" \
      ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
      INTERNAL_API_SECRET="$internal_secret" \
      COPILOT_API_KEY="$copilot_key" \
      SIM_AGENT_API_URL="http://127.0.0.1:$proxy_port" \
      MOTHERSHIP_SIM_TRANSPORT=direct \
      node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port "$app_port"
  ) >"$state_dir/app.log" 2>&1 &
  echo $! >"$state_dir/app.pid"
  set +m
  wait_for app "$app_url/api/health" "$state_dir/app.pid" 600
}

run_test() {
  cd "$app_dir"
  scrubbed \
    CHAT_STEERING_E2E_BASE_URL="$app_url" \
    CHAT_STEERING_E2E_WORKER_URL="http://127.0.0.1:$worker_port" \
    CHAT_STEERING_E2E_PROXY_PORT="$proxy_port" \
    CHAT_STEERING_E2E_MODEL_PORT="$model_port" \
    CHAT_STEERING_E2E_DATABASE_URL="$database_url" \
    CHAT_STEERING_E2E_WORKER_DATABASE_URL="$worker_database_url" \
    CHAT_STEERING_E2E_AUTH_SECRET="$auth_secret" \
    CHAT_STEERING_E2E_REPORT_PATH="$report_path" \
    CHAT_STEERING_E2E_UPLOADS_PATH="$app_dir/uploads" \
    ${CHAT_STEERING_E2E_ONLY:+CHAT_STEERING_E2E_ONLY="$CHAT_STEERING_E2E_ONLY"} \
    bun --no-env-file scripts/test-chat-steering-e2e.ts
}

case "$command" in
  up) up ;;
  down) down ;;
  test) run_test ;;
  run)
    trap down EXIT
    up
    run_test
    ;;
  *)
    echo "usage: chat-steering-e2e.sh <run|up|test|down>" >&2
    exit 2
    ;;
esac
