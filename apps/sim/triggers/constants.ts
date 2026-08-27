/**
 * System subblock IDs that are part of the trigger UI infrastructure
 * and should NOT be aggregated into triggerConfig or validated as user fields.
 *
 * These subblocks provide UI/UX functionality but aren't configuration data.
 */
export const SYSTEM_SUBBLOCK_IDS: string[] = [
  'triggerCredentials', // OAuth credentials subblock
  'triggerInstructions', // Setup instructions text
  'webhookUrlDisplay', // Webhook URL display
  'samplePayload', // Example payload display
  'setupScript', // Setup script code (e.g., Apps Script)
  'scheduleInfo', // Schedule status display (next run, last run)
]

/**
 * Trigger-related subblock IDs that represent runtime metadata. They should remain
 * in the workflow state but must not be modified or cleared by diff operations.
 *
 * Note: 'triggerConfig' is included because it is an aggregate of the individual
 * trigger field subblocks, which are compared separately — comparing the
 * aggregate too would double-count them.
 *
 * It is also a write guard: `edit_workflow` rejects writes to these ids, which
 * is what stops the copilot resurrecting the modal-era aggregate. Do not remove
 * an entry here on the grounds that the comparison no longer needs it.
 */
export const TRIGGER_RUNTIME_SUBBLOCK_IDS: string[] = [
  'webhookId',
  'triggerPath',
  'triggerConfig',
  'triggerId',
]

/**
 * Synthesized read-only field exposing a webhook trigger block's public URL in the
 * copilot's read view of workflow state (see sanitizeForCopilot). The URL is derived
 * at read time — it is never persisted — and edit_workflow rejects writes to it.
 *
 * Deliberately NOT 'webhookUrl': that id is a real user-editable subblock on some
 * action blocks (e.g. Vercel's create_webhook target URL).
 */
export const TRIGGER_WEBHOOK_URL_FIELD = 'triggerWebhookUrl'

/**
 * Derived, read-only input surfaced on copilot reads of trigger blocks that
 * route by CREDENTIAL rather than a per-workflow webhook URL (e.g. Slack v2's
 * `slack_oauth`). Explains where events actually arrive — a custom bot's
 * per-credential Request URL or the shared Sim-app endpoint — so the copilot
 * can answer "where do I point Slack?" without inventing a field. Never
 * stored; rejected on write like {@link TRIGGER_WEBHOOK_URL_FIELD}.
 */
export const TRIGGER_ROUTING_FIELD = 'triggerRouting'

/**
 * Maximum number of consecutive failures before a trigger (schedule/webhook) is auto-disabled.
 * This prevents runaway errors from continuously executing failing workflows.
 */
export const MAX_CONSECUTIVE_FAILURES = 100

/**
 * Set of webhook provider names that use polling-based triggers.
 * Mirrors the `polling: true` flag on TriggerConfig entries.
 * Used to route execution: polling providers use the full job queue
 * (Trigger.dev), non-polling providers execute inline.
 */
export const POLLING_PROVIDERS = new Set([
  'gmail',
  'google-calendar',
  'google-drive',
  'google-sheets',
  'hubspot',
  'imap',
  'outlook',
  'rss',
])

export function isPollingWebhookProvider(provider: string | null): boolean {
  return provider !== null && POLLING_PROVIDERS.has(provider)
}

/**
 * Providers whose triggers fire internally (table row events, Sim workspace
 * events) rather than via external HTTP webhooks. Their webhook rows still
 * register a path, so the public trigger route must reject deliveries to
 * them — otherwise anyone with the block ID could forge events.
 */
export const INTERNAL_TRIGGER_PROVIDERS = new Set(['sim', 'table'])

export function isInternalTriggerProvider(provider: string | null): boolean {
  return provider !== null && INTERNAL_TRIGGER_PROVIDERS.has(provider)
}
