# Scheduler for the Docker Compose deployment.
#
# Runs the same background jobs the Helm chart schedules as Kubernetes CronJobs,
# so both deployment paths have the same functionality. Without this service,
# scheduled workflows, polling triggers, connector syncs, the transactional
# outbox, and data drains never run.
#
# supercronic is used rather than busybox crond because it logs job output to
# stdout (crond only reaches syslog/sendmail), forwards SIGTERM to running jobs
# so `docker compose stop` is graceful, and refuses to start an iteration while
# the previous one is still running.
FROM alpine:3.21

ARG SUPERCRONIC_VERSION=v0.2.33
ARG TARGETARCH
ARG SUPERCRONIC_SHA256_amd64=feefa310da569c81b99e1027b86b27b51e6ee9ab647747b49099645120cfc671
ARG SUPERCRONIC_SHA256_arm64=f1f8585c66de020fef494dd636058f99949d108f569fef00016a1c8b9eb145b3

RUN set -eux; \
    apk add --no-cache ca-certificates curl tzdata; \
    case "${TARGETARCH}" in \
      amd64) sha="${SUPERCRONIC_SHA256_amd64}" ;; \
      arm64) sha="${SUPERCRONIC_SHA256_arm64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH}"; \
    echo "${sha}  /usr/local/bin/supercronic" | sha256sum -c -; \
    chmod +x /usr/local/bin/supercronic; \
    addgroup -g 1001 -S sim; \
    adduser -u 1001 -S -G sim -H sim

COPY docker/crontab /etc/sim/crontab
COPY docker/cron-entrypoint.sh /usr/local/bin/cron-entrypoint.sh
RUN chmod +x /usr/local/bin/cron-entrypoint.sh

USER 1001:1001

# The wrapper exits 0 with an actionable message when CRON_SECRET is unset,
# so an upgrade from a compose file that predates the scheduler still starts.
ENTRYPOINT ["/usr/local/bin/cron-entrypoint.sh"]
