import type { webhook, workflow } from '@sim/db/schema'
import type { Logger } from '@sim/logger'

/** Summary returned after polling all webhooks for a provider. */
export interface PollSummary {
  total: number
  successful: number
  failed: number
}

/** Context passed to a provider handler when processing one webhook. */
export interface PollWebhookContext {
  webhookData: WebhookRecord
  workflowData: WorkflowRecord
  requestId: string
  logger: Logger
}

export type WebhookRecord = typeof webhook.$inferSelect
export type WorkflowRecord = typeof workflow.$inferSelect

/**
 * Strategy interface for provider-specific polling behavior.
 * Mirrors `WebhookProviderHandler` from `providers/types.ts`.
 *
 * Each provider implements `pollWebhook()` — the full inner loop for one webhook:
 * validate config, resolve credentials, fetch new items, process each via
 * `processPolledWebhookEvent()` (wrapped in `pollingIdempotency`), update state.
 */
export interface PollingProviderHandler {
  /** Provider name used in DB queries (e.g. 'gmail', 'rss'). */
  readonly provider: string

  /** Display label for log messages (e.g. 'Gmail', 'RSS'). */
  readonly label: string

  /**
   * Process a single webhook entry.
   * Return 'success' (even if 0 new items) or 'failure'.
   */
  pollWebhook(ctx: PollWebhookContext): Promise<'success' | 'failure'>
}
