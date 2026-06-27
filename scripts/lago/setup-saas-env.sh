#!/usr/bin/env bash
set -euo pipefail

# Generates local SaaS env for Sim connected to AAC Billing Lago.
# Prerequisite: Lago running in ~/aac-billing/lago (docker compose up)
# Usage: ./scripts/lago/setup-saas-env.sh

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AAC_LAGO_ENV="${AAC_LAGO_ENV:-${HOME}/aac-billing/lago/.env}"

AUTH="$(openssl rand -hex 32)"
ENC="$(openssl rand -hex 32)"
INTERNAL="$(openssl rand -hex 32)"
API_ENC="$(openssl rand -hex 32)"

LAGO_API_URL="${LAGO_API_URL:-http://localhost:6100}"
LAGO_API_KEY="${LAGO_API_KEY:-}"

if [[ -z "${LAGO_API_KEY}" && -f "${AAC_LAGO_ENV}" ]]; then
  LAGO_API_KEY="$(grep -E '^AACWORKFLOW_LAGO_API_KEY=' "${AAC_LAGO_ENV}" | cut -d= -f2- | tr -d '"' || true)"
fi

if [[ -z "${LAGO_API_KEY}" ]]; then
  LAGO_API_KEY="cfdbe9a0-0fa6-4d7b-961c-8d66f26c9e3a"
fi

cat > "${ROOT}/apps/sim/.env" <<EOF
# Local SaaS dev — AAC Billing Lago (aacworkflow org)

DATABASE_URL=postgresql://postgres:postgres@localhost:12002/simstudio

BETTER_AUTH_SECRET=${AUTH}
BETTER_AUTH_URL=http://localhost:12000
NEXT_PUBLIC_APP_URL=http://localhost:12000
NEXT_PUBLIC_SOCKET_URL=http://localhost:12001

ENCRYPTION_KEY=${ENC}
INTERNAL_API_SECRET=${INTERNAL}
API_ENCRYPTION_KEY=${API_ENC}

REDIS_URL=redis://localhost:6379

BILLING_ENABLED=true
NEXT_PUBLIC_BILLING_ENABLED=true
BILLING_PROVIDER=lago
NEXT_PUBLIC_BILLING_PROVIDER=lago

LAGO_API_URL=${LAGO_API_URL}
LAGO_API_KEY=${LAGO_API_KEY}
LAGO_PRODUCT_SLUG=aacworkflow
LAGO_WEBHOOK_SECRET=

LAGO_BILLABLE_METRIC_CODE=llm_cost
LAGO_PLAN_FREE=aacworkflow_free
LAGO_PLAN_PRO_6000=sim_pro_6000
LAGO_PLAN_PRO_25000=sim_pro_25000
LAGO_PLAN_TEAM_6000=sim_team_6000
LAGO_PLAN_TEAM_25000=sim_team_25000
LAGO_PLAN_ENTERPRISE=sim_enterprise

FREE_TIER_COST_LIMIT=5
PLATFORM_ADMIN_EMAILS=info@aacflow.io
EOF

cat > "${ROOT}/apps/realtime/.env" <<EOF
NODE_ENV=development
PORT=3002

DATABASE_URL=postgresql://postgres:postgres@localhost:12002/simstudio

BETTER_AUTH_URL=http://localhost:12000
BETTER_AUTH_SECRET=${AUTH}
INTERNAL_API_SECRET=${INTERNAL}
NEXT_PUBLIC_APP_URL=http://localhost:12000
EOF

echo "✓ Created ${ROOT}/apps/sim/.env (AAC Billing Lago @ ${LAGO_API_URL})"
echo "✓ Created ${ROOT}/apps/realtime/.env"
echo ""
echo "Prerequisite: cd ~/aac-billing/lago && docker compose up -d"
echo ""
echo "Next steps:"
echo "  LAGO_API_KEY=${LAGO_API_KEY} ./scripts/lago/bootstrap-plans.sh   # tier plans (pro/team)"
echo "  Webhook in Lago UI (http://localhost:6001): http://localhost:12000/api/billing/lago/webhook"
echo "  bun run dev:full"
