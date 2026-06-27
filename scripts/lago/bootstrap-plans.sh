#!/usr/bin/env bash
set -euo pipefail

# Bootstraps Sim tier plans in the aacworkflow Lago org (idempotent).
# PAYG + llm_cost: ~/aac-billing/lago/lago-setup/setup_products.py
# Full catalog:   ~/aac-billing/lago/lago-setup/setup_sim_plans.py

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAGO_API_URL="${LAGO_API_URL:-http://localhost:6100}"
PRODUCT_SLUG="${LAGO_PRODUCT_SLUG:-aacworkflow}"

if [[ -z "${LAGO_API_KEY:-}" ]]; then
  if [[ -f "${ROOT}/apps/sim/.env" ]]; then
    LAGO_API_KEY="$(grep -E '^LAGO_API_KEY=' "${ROOT}/apps/sim/.env" | cut -d= -f2- | tr -d '"' || true)"
  fi
  if [[ -z "${LAGO_API_KEY:-}" && -f "${HOME}/aac-billing/lago/.env" ]]; then
    LAGO_API_KEY="$(grep -E '^AACWORKFLOW_LAGO_API_KEY=' "${HOME}/aac-billing/lago/.env" | cut -d= -f2- | tr -d '"' || true)"
  fi
fi

LAGO_API_KEY="${LAGO_API_KEY:?Set LAGO_API_KEY or configure apps/sim/.env}"

auth_header=( -H "Authorization: Bearer ${LAGO_API_KEY}" -H "Content-Type: application/json" )

plan_exists() {
  local code="$1"
  curl -sf "${auth_header[@]}" "${LAGO_API_URL}/api/v1/plans/${code}" >/dev/null 2>&1
}

ensure_metric() {
  local code="$1"
  local name="$2"
  local field="$3"
  local existing
  existing="$(curl -sf "${auth_header[@]}" "${LAGO_API_URL}/api/v1/billable_metrics/${code}" 2>/dev/null | jq -r '.billable_metric.lago_id // empty' || true)"
  if [[ -n "${existing}" ]]; then
    echo "  metric ${code} exists"
    echo "${existing}"
    return
  fi
  echo "  creating metric ${code}..."
  existing="$(curl -sf "${auth_header[@]}" -X POST "${LAGO_API_URL}/api/v1/billable_metrics" -d "$(jq -n \
    --arg code "$code" --arg name "$name" --arg field "$field" \
    '{billable_metric:{name:$name,code:$code,aggregation_type:"sum_agg",field_name:$field,recurring:false}}')" \
    | jq -r '.billable_metric.lago_id // empty')"
  echo "${existing}"
}

create_plan() {
  local code="$1"
  local name="$2"
  local amount_cents="$3"
  local metric_id="$4"
  local charge_model="${5:-standard}"
  local amount="${6:-0.005}"

  if plan_exists "${code}"; then
    echo "  plan ${code} exists"
    return
  fi

  echo "  creating plan ${code}..."
  local response
  response="$(curl -s -w "\n%{http_code}" "${auth_header[@]}" -X POST "${LAGO_API_URL}/api/v1/plans" -d "$(jq -n \
    --arg code "$code" \
    --arg name "$name" \
    --argjson amount_cents "$amount_cents" \
    --arg metric_id "$metric_id" \
    --arg charge_model "$charge_model" \
    --arg amount "$amount" \
    '{
      plan: {
        name: $name,
        code: $code,
        interval: "monthly",
        amount_cents: $amount_cents,
        amount_currency: "USD",
        pay_in_advance: false,
        charges: [
          {
            billable_metric_id: $metric_id,
            charge_model: $charge_model,
            properties: { amount: $amount }
          }
        ]
      }
    }')")"
  local http_code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${http_code}" != "200" && "${http_code}" != "201" ]]; then
    echo "  FAILED plan ${code} (HTTP ${http_code}): ${body}" >&2
    return 1
  fi
}

echo "Ensuring billable metrics..."
METRIC_ID="$(ensure_metric "workflow_credits" "Workflow Credits" "cost_usd" | tail -1)"
LLM_METRIC_ID="$(ensure_metric "llm_cost" "LLM Cost" "unit" | tail -1)"

echo "Ensuring Sim tier plans (${PRODUCT_SLUG})..."
create_plan "${PRODUCT_SLUG}_free" "Sim Free" 0 "${METRIC_ID}" "standard" "0.005"
create_plan "${PRODUCT_SLUG}_payg" "Sim PAYG" 0 "${LLM_METRIC_ID}" "dynamic" "0"
create_plan "sim_pro_6000" "Sim Pro" 2500 "${METRIC_ID}"
create_plan "sim_pro_25000" "Sim Max" 10000 "${METRIC_ID}"
create_plan "sim_team_6000" "Sim Team Pro" 2500 "${METRIC_ID}"
create_plan "sim_team_25000" "Sim Team Max" 10000 "${METRIC_ID}"
create_plan "sim_enterprise" "Sim Enterprise" 0 "${METRIC_ID}"

echo "Done. Webhook: http://localhost:12000/api/billing/lago/webhook"
