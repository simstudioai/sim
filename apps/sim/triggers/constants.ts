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
  'triggerSave', // UI-only save button — stores no config data
]

/**
 * Trigger-related subblock IDs that represent runtime metadata. They should remain
 * in the workflow state but must not be modified or cleared by diff operations.
 *
 * Note: 'triggerConfig' is included because it's an aggregate of individual trigger
 * field subblocks. Those individual fields are compared separately, so comparing
 * triggerConfig would be redundant. Additionally, the client populates triggerConfig
 * with default values from the trigger definition on load, which aren't present in
 * the deployed state, causing false positive change detection.
 */
export const TRIGGER_RUNTIME_SUBBLOCK_IDS: string[] = [
  'webhookId',
  'triggerPath',
  'triggerConfig',
  'triggerId',
]

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
  'imap',
  'outlook',
  'rss',
])

export function isPollingWebhookProvider(provider: string): boolean {
  return POLLING_PROVIDERS.has(provider)
}
