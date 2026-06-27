#!/bin/bash
set -euo pipefail

echo "🔧 Lago Billing Activation"
echo "=========================="
echo ""

# Check for required env vars
if [ -z "${LAGO_API_KEY:-}" ]; then
  echo "❌ LAGO_API_KEY is not set"
  echo "   Get your API key from the AAC Billing Lago UI: http://localhost:6001/settings/api-keys"
  exit 1
fi

if [ -z "${LAGO_WEBHOOK_SECRET:-}" ]; then
  LAGO_WEBHOOK_SECRET=$(openssl rand -hex 32)
  echo "🔑 Generated LAGO_WEBHOOK_SECRET: $LAGO_WEBHOOK_SECRET"
  echo "   Add this to your Lago webhook settings"
fi

# Set defaults — AAC Billing Lago (base URL only; the app appends /api/v1)
export LAGO_API_URL="${LAGO_API_URL:-http://localhost:6100}"
export LAGO_BILLING_ENABLED="${LAGO_BILLING_ENABLED:-true}"

echo ""
echo "✅ Lago billing configuration:"
echo "   LAGO_API_URL=$LAGO_API_URL"
echo "   LAGO_BILLING_ENABLED=$LAGO_BILLING_ENABLED"
echo "   LAGO_WEBHOOK_SECRET=${LAGO_WEBHOOK_SECRET:0:8}..."
echo ""
echo "📋 Next steps:"
echo "   1. Add these to your .env file"
echo "   2. Run DB migration: cd packages/db && bun run migrate"
echo "   3. Configure Lago plans and billable metrics"
echo "   4. Set up webhook endpoint in Lago: https://your-domain.com/api/billing/lago/webhook"
echo ""
echo "🚀 Ready to enable Lago billing!"
