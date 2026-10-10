#!/usr/bin/env bash
# Runs one end-to-end suite group over real HTTP, each against its own `next dev` app.
#
# Usage: http-e2e.sh <scim|cli|stop-after|desktop-inbox|project-files|mobile>   (run from apps/sim)
#
# The job provides DATABASE_URL, BETTER_AUTH_SECRET and ENCRYPTION_KEY; each group sets the rest of
# its app's environment here. Reports and server logs land in $RUNNER_TEMP/e2e.
#
# The first request cold-compiles the app under Turbopack, which takes 42-150s on CI runners, so
# the readiness deadline only has to catch a hung boot: an exited server fails immediately, and
# either way the server log tail lands in the job log.
#
# Each app starts from an empty Turbopack dev cache: a cache written under other NEXT_PUBLIC_*
# values, by a server that `next dev` SIGKILLs 100ms after SIGTERM, can panic Turbopack or wedge a
# route compile on restore. It runs in its own session under an E2E_APP tag, and stop-session.sh
# returns only once every process in that session or carrying that tag has exited (Next's
# telemetry flush runs detached and still writes .next/dev).
set -euo pipefail

group=${1:?usage: http-e2e.sh <scim|cli|stop-after|desktop-inbox|project-files|mobile>}
report_dir="$RUNNER_TEMP/e2e"
ready_timeout_seconds=300
mkdir -p "$report_dir"

server_pid=''
app_tag=''
server_log=''
status_log=''

finish() {
  local status=$?
  if [ -n "$server_pid" ]; then
    bash "$GITHUB_WORKSPACE/.github/scripts/stop-session.sh" "$server_pid" "$app_tag" || status=1
    wait "$server_pid" 2>/dev/null || true
    if [ -n "$status_log" ]; then
      awk '/^ (GET|POST|PUT|PATCH|DELETE|HEAD) \/api\// { print }' "$server_log" > "$status_log"
    fi
    if [ "$status" -ne 0 ]; then
      tail -n 200 "$server_log"
    fi
  fi
  exit "$status"
}
trap finish EXIT

# start_app <name> <port> <label> [record-http-status]
start_app() {
  local name=$1 port=$2 label=$3
  server_log="$report_dir/$name-next.log"
  if [ "${4:-}" = record-http-status ]; then
    status_log="$report_dir/$name-http-status.log"
  fi
  app_tag="$name-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$$"
  export NEXT_PUBLIC_APP_URL="http://127.0.0.1:$port"
  export BETTER_AUTH_URL="$NEXT_PUBLIC_APP_URL"
  export DISABLE_TELEMETRY=true NEXT_TELEMETRY_DISABLED=1
  rm -rf .next/dev
  E2E_APP="$app_tag" setsid node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 \
    --port "$port" > "$server_log" 2>&1 &
  server_pid=$!

  local started=$SECONDS
  until curl --fail --silent --max-time 10 "$NEXT_PUBLIC_APP_URL/api/health" > /dev/null; do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      echo "::error::Local $label app exited during startup."
      exit 1
    fi
    if [ $((SECONDS - started)) -ge "$ready_timeout_seconds" ]; then
      echo "::error::Local $label app did not become ready within $ready_timeout_seconds seconds."
      exit 1
    fi
    sleep 2
  done
  echo "Local $label app ready after $((SECONDS - started))s"
}

case "$group" in
  scim)
    export NEXT_PUBLIC_FORCE_HOSTED=true
    export BILLING_ENABLED=true NEXT_PUBLIC_BILLING_ENABLED=true
    export ENTERPRISE_ENABLED=true NEXT_PUBLIC_ENTERPRISE_ENABLED=true
    export SCIM_ENABLED=true NEXT_PUBLIC_SCIM_ENABLED=true
    export SSO_ENABLED=true NEXT_PUBLIC_SSO_ENABLED=true
    export ORGANIZATIONS_ENABLED=true NEXT_PUBLIC_ORGANIZATIONS_ENABLED=true
    export INTERNAL_API_SECRET=scim-http-ci-local-secret-at-least-32-characters
    export DB_TX_TRIPWIRE=throw
    export NEXT_PUBLIC_CHAT_DISABLED=true
    start_app scim 3017 SCIM record-http-status
    SCIM_E2E_BASE_URL="$NEXT_PUBLIC_APP_URL" \
    SCIM_E2E_DATABASE_URL="$DATABASE_URL" \
    SCIM_E2E_AUTH_SECRET="$BETTER_AUTH_SECRET" \
    SCIM_E2E_REPORT_PATH="$report_dir/scim-e2e-report.json" \
      bun run test:scim:e2e
    VERSION_COMPARE_E2E_BASE_URL="$NEXT_PUBLIC_APP_URL" \
    VERSION_COMPARE_E2E_DATABASE_URL="$DATABASE_URL" \
    VERSION_COMPARE_E2E_AUTH_SECRET="$BETTER_AUTH_SECRET" \
    VERSION_COMPARE_E2E_REPORT_PATH="$report_dir/version-compare-http-report.json" \
      bun run test:workflow-version-compare:e2e
    ;;

  # The search suites serve their own fixtures in-process and need no app. They share this group
  # because they finish in seconds. Self-hosted without billing: hosted billing admits runs through
  # Redis, which the CLI app is not given.
  cli)
    for search in google-content lucid zoom google-meet; do
      report_var="SEARCH_$(echo "$search" | tr 'a-z-' 'A-Z_')_REPORT_PATH"
      env NEXT_PUBLIC_APP_URL=http://127.0.0.1:3040 NEXT_PUBLIC_FORCE_HOSTED=false \
        "$report_var=$report_dir/search-$search.json" \
        bun "scripts/test-search-$search-e2e.ts"
    done
    export NEXT_PUBLIC_FORCE_HOSTED=false
    export INTERNAL_API_SECRET=cli-http-ci-local-secret-at-least-32-characters
    export SIM_MCP_URL=http://mcp.sim.test/mcp
    start_app cli 3018 CLI
    MCP_HOST_E2E_BASE_URL="$NEXT_PUBLIC_APP_URL" \
    MCP_HOST_E2E_REPORT_PATH="$report_dir/mcp-host-e2e-report.json" \
      bun --no-env-file scripts/test-mcp-host-e2e.ts
    CLI_LATENCY_E2E_BASE_URL="$NEXT_PUBLIC_APP_URL" \
    CLI_LATENCY_E2E_DATABASE_URL="$DATABASE_URL" \
    CLI_LATENCY_E2E_RUNS=3 \
    CLI_LATENCY_E2E_WARMUP=1 \
    CLI_LATENCY_E2E_REPORT_PATH="$report_dir/cli-run-latency-report.json" \
      bun run test:cli-run-latency:e2e
    ;;

  # Self-hosted: hosted billing admits a run only through a Redis usage reservation.
  stop-after)
    export NEXT_PUBLIC_FORCE_HOSTED=false
    export CRON_SECRET=stop-after-e2e-local-cron-secret
    export INTERNAL_API_SECRET=stop-after-http-ci-local-secret-at-least-32-characters
    export DB_TX_TRIPWIRE=throw
    export NEXT_PUBLIC_CHAT_DISABLED=true
    start_app stop-after 3018 workflow record-http-status
    STOP_AFTER_E2E_BASE_URL="$NEXT_PUBLIC_APP_URL" \
    STOP_AFTER_E2E_DATABASE_URL="$DATABASE_URL" \
    STOP_AFTER_E2E_REPORT_PATH="$report_dir/stop-after-http-report.json" \
    STOP_AFTER_E2E_CRON_SECRET="$CRON_SECRET" \
      bun run test:workflow-stop-after:e2e
    ;;

  # The desktop background executor's protocol: device registration, the SSE doorbell over Redis
  # pub/sub, presence, leased claims, Stop and isolation. The only group whose app gets Redis.
  desktop-inbox)
    export REDIS_URL=redis://127.0.0.1:6379
    export NEXT_PUBLIC_FORCE_HOSTED=false
    export COPILOT_TOOL_PERMISSIONS_ENABLED=true
    export INTERNAL_API_SECRET=desktop-inbox-http-ci-local-secret-at-least-32-characters
    export DB_TX_TRIPWIRE=throw
    start_app desktop-inbox 3019 'desktop executor' record-http-status
    DESKTOP_INBOX_E2E_BASE_URL="$NEXT_PUBLIC_APP_URL" \
    DESKTOP_INBOX_E2E_DATABASE_URL="$DATABASE_URL" \
    DESKTOP_INBOX_E2E_REDIS_URL="$REDIS_URL" \
    DESKTOP_INBOX_E2E_AUTH_SECRET="$BETTER_AUTH_SECRET" \
    DESKTOP_INBOX_E2E_REPORT_PATH="$report_dir/desktop-inbox-http-report.json" \
      bun run test:desktop-inbox:e2e
    ;;

  project-files)
    PROJECT_FILES_E2E_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres \
    PROJECT_FILES_E2E_REDIS_URL=redis://127.0.0.1:6379 \
    PROJECT_FILES_E2E_BASE_URL=http://127.0.0.1:3050 \
    PROJECT_FILES_E2E_RELAY_URL=http://127.0.0.1:3052 \
    PROJECT_FILES_E2E_REPORT_PATH="$report_dir/project-files/orchestration.json" \
      bun --no-env-file scripts/test-project-files-e2e.ts
    ;;

  mobile)
    export NEXT_PUBLIC_FORCE_HOSTED=false
    export INTERNAL_API_SECRET=mobile-http-ci-local-secret-at-least-32-characters
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=12288"
    bunx --no-install playwright install --with-deps chromium webkit
    start_app mobile 3024 'mobile browser' record-http-status
    MOBILE_E2E_BASE_URL="$NEXT_PUBLIC_APP_URL" \
    MOBILE_E2E_DATABASE_URL="$DATABASE_URL" \
    MOBILE_E2E_AUTH_SECRET="$BETTER_AUTH_SECRET" \
    MOBILE_E2E_REPORT_PATH="$report_dir/mobile-e2e-report.json" \
      bun run test:mobile:e2e
    ;;

  *)
    echo "::error::Unknown end-to-end group: $group" >&2
    exit 2
    ;;
esac
