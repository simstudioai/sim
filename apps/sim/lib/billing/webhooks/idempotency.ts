import { IdempotencyService } from '@/lib/core/idempotency/service'

/**
 * Idempotency service for Stripe webhook handlers.
 *
 * Stripe delivers webhook events at-least-once and retries failed
 * deliveries for up to 3 days. Handlers that perform non-idempotent work
 * (crediting accounts, removing credits, resetting usage trackers, etc.)
 * must be wrapped in a claim so duplicate deliveries are collapsed to a
 * single execution.
 *
 * Storage is **forced to Postgres** regardless of whether Redis is
 * configured. Billing handlers mutate `user_stats` / `organization` /
 * `subscription` rows via DB transactions — keeping the idempotency
 * record in the same Postgres closes the narrow window where the
 * operation commits but a Redis `storeResult` fails, which would cause
 * Stripe's next retry to re-run the money-affecting work. The latency
 * cost (1–5 ms per claim/store) is invisible on webhook responses, and
 * volume is low enough (roughly one event per customer per billing
 * cycle) that DB storage scales comfortably.
 *
 * `retryFailures: true` means a thrown handler releases the claim so
 * Stripe's next retry runs from scratch — without it, one transient
 * failure would poison the key for the whole TTL window.
 *
 * TTL of 7 days is slightly longer than Stripe's 3-day retry horizon so
 * late retries still dedupe against completed work. Rows past their TTL
 * are handled two ways: `atomicallyClaimDb` reclaims stale rows inline
 * via `ON CONFLICT DO UPDATE WHERE created_at < expired_before` (so
 * correctness does not depend on cleanup running), and the external
 * cleanup cron (scheduled from the infra repo) hits
 * `/api/webhooks/cleanup/idempotency` to bound table size.
 */
export const stripeWebhookIdempotency = new IdempotencyService({
  namespace: 'stripe-webhook',
  ttlSeconds: 60 * 60 * 24 * 7,
  retryFailures: true,
  forceStorage: 'database',
})
