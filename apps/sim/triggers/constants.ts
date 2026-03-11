/**
 * Set of webhook provider names that use polling-based triggers.
 * Mirrors the `polling: true` flag on TriggerConfig entries.
 * Used to route execution: polling providers use the full job queue
 * (Trigger.dev), non-polling providers execute inline.
 */
export const POLLING_PROVIDERS = new Set(['gmail', 'outlook', 'rss', 'imap'])

export function isPollingWebhookProvider(provider: string): boolean {
  return POLLING_PROVIDERS.has(provider)
}
