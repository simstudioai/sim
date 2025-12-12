-- Backfill user_stats for any users missing a stats row
-- Uses defaults from schema for limits and counters

INSERT INTO "user_stats" (
  "id",
  "user_id",
  "current_usage_limit",
  "usage_limit_updated_at",
  "total_manual_executions",
  "total_api_calls",
  "total_webhook_triggers",
  "total_scheduled_executions",
  "total_chat_executions",
  "total_tokens_used",
  "total_cost",
  "current_period_cost",
  "last_period_cost",
  "total_copilot_cost",
  "total_copilot_tokens",
  "total_copilot_calls",
  "last_active",
  "billing_blocked"
)
SELECT
  u."id" AS id,
  u."id" AS user_id,
  NULL::decimal AS current_usage_limit,
  NOW() AS usage_limit_updated_at,
  0 AS total_manual_executions,
  0 AS total_api_calls,
  0 AS total_webhook_triggers,
  0 AS total_scheduled_executions,
  0 AS total_chat_executions,
  0 AS total_tokens_used,
  '0'::decimal AS total_cost,
  '0'::decimal AS current_period_cost,
  '0'::decimal AS last_period_cost,
  '0'::decimal AS total_copilot_cost,
  0 AS total_copilot_tokens,
  0 AS total_copilot_calls,
  NOW() AS last_active,
  FALSE AS billing_blocked
FROM "user" u
LEFT JOIN "user_stats" s ON s."user_id" = u."id"
WHERE s."user_id" IS NULL;


