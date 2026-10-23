#!/bin/sh
# Starts uvicorn as PID 1 (exec) so SIGTERM reaches it directly. Quoted expansions
# make a malformed PII_WORKERS fail uvicorn's arg parsing, not the shell.
set -- --host 0.0.0.0 --port 5001 --workers "${PII_WORKERS:-1}" --timeout-graceful-shutdown 300

# The load balancer in front keeps idle connections to this service open for 300s and
# reuses them. uvicorn's 5s default closed them first, so a request sent on a connection
# uvicorn was closing came back as an instant load-balancer 502. Keep-alive must outlast
# the load balancer's idle timeout so the load balancer is always the side that closes.
set -- "$@" --timeout-keep-alive "${PII_TIMEOUT_KEEP_ALIVE:-310}"

# Worker memory grows with uptime, so with a supervisor (more than one worker) each
# worker exits after a jittered request count, health checks included, and is
# respawned. A single worker has no supervisor to respawn it, so it never recycles.
if [ "${PII_WORKERS:-1}" -gt 1 ] 2>/dev/null; then
  set -- "$@" --limit-max-requests "${PII_MAX_REQUESTS:-4000}" \
    --limit-max-requests-jitter "${PII_MAX_REQUESTS_JITTER:-2000}"
fi

exec uvicorn server:app "$@"
