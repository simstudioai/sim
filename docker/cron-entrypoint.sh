#!/bin/sh
# Refuses to run without CRON_SECRET, but exits 0 so `restart: on-failure`
# leaves the container stopped instead of crash-looping. The rest of the stack
# is unaffected — this keeps upgrades from an older compose file working, since
# CRON_SECRET did not exist before the scheduler was added.
set -eu

if [ -z "${CRON_SECRET:-}" ]; then
  echo "sim-cron: CRON_SECRET is not set — background jobs are disabled." >&2
  echo "sim-cron:" >&2
  echo "sim-cron: Scheduled workflows, polling triggers (Gmail, Outlook, IMAP," >&2
  echo "sim-cron: RSS, Drive, Sheets, Calendar, HubSpot), knowledge base connector" >&2
  echo "sim-cron: syncs, and data drains will not run until it is configured." >&2
  echo "sim-cron:" >&2
  echo "sim-cron: Add this to the .env file next to docker-compose.prod.yml," >&2
  echo "sim-cron: then run: docker compose -f docker-compose.prod.yml up -d" >&2
  echo "sim-cron:" >&2
  echo "sim-cron:   CRON_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >&2
  echo "sim-cron:" >&2
  echo "sim-cron: The app container must receive the same value." >&2
  exit 0
fi

exec /usr/local/bin/supercronic -passthrough-logs /etc/sim/crontab
