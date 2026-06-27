# Lago Billing Setup

## Quick Start

```bash
# 1. Set API key
export LAGO_API_KEY="your-lago-api-key"

# 2. Run activation
source scripts/lago/activate.sh

# 3. Apply DB migration
cd packages/db && bun run migrate

# 4. Restart
cd apps/sim && bun dev
```

## Lago Configuration

### Billable Metrics (create in Lago dashboard)

| Code | Name | Aggregation | Field |
|------|------|-------------|-------|
| `ai_usage` | AI Usage | sum | `properties.tokens` |
| `workflow_exec` | Workflow Executions | count | — |
| `storage_gb` | Storage | max | `properties.gb` |
| `seat` | Team Seats | max | `properties.count` |

### Plans (map to Sim plans)

| Sim Plan | Lago Plan Code | Metrics |
|----------|---------------|---------|
| Free | `sim_free` | ai_usage (up to $5) |
| Pro | `sim_pro` | ai_usage, workflow_exec |
| Max | `sim_max` | ai_usage, workflow_exec |
| Team Pro | `sim_team_pro` | ai_usage, workflow_exec, seat |
| Team Max | `sim_team_max` | ai_usage, workflow_exec, seat |
| Enterprise | `sim_enterprise` | all |

### Webhook Setup

1. In Lago dashboard → Settings → Webhooks
2. Add endpoint: `https://your-domain.com/api/billing/lago/webhook`
3. Set signing secret to match `LAGO_WEBHOOK_SECRET`
4. Enable events: `subscription.started`, `subscription.terminated`, `invoice.paid`, `invoice.payment_failure`
