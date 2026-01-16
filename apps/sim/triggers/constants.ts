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
  'triggerSave', // Save configuration button
  'samplePayload', // Example payload display
  'setupScript', // Setup script code (e.g., Apps Script)
  'triggerId', // Stored trigger ID
  'selectedTriggerId', // Selected trigger from dropdown (multi-trigger blocks)
]

/**
 * Trigger-related subblock IDs whose values should be persisted and
 * propagated when workflows are edited programmatically.
 */
export const TRIGGER_PERSISTED_SUBBLOCK_IDS: string[] = [
  'triggerConfig',
  'triggerCredentials',
  'triggerId',
  'selectedTriggerId',
  'webhookId',
  'triggerPath',
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
export const TRIGGER_RUNTIME_SUBBLOCK_IDS: string[] = ['webhookId', 'triggerPath', 'triggerConfig']

/**
 * Maximum number of consecutive failures before a trigger (schedule/webhook) is auto-disabled.
 * This prevents runaway errors from continuously executing failing workflows.
 */
export const MAX_CONSECUTIVE_FAILURES = 100
