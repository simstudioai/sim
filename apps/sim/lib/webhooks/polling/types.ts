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

/** DB row shape for the webhook table. */
export interface WebhookRecord {
  id: string
  path: string
  provider: string | null
  blockId: string | null
  providerConfig: unknown
  credentialSetId: string | null
  workflowId: string
  [key: string]: unknown
}

/** DB row shape for the workflow table. */
export interface WorkflowRecord {
  id: string
  userId: string
  workspaceId: string
  [key: string]: unknown
}

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
