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
  'testUrl',
  'testUrlExpiresAt',
]

/**
 * Trigger and schedule-related subblock IDs that represent runtime metadata. They should remain
 * in the workflow state but must not be modified or cleared by diff operations.
 */
export const TRIGGER_RUNTIME_SUBBLOCK_IDS: string[] = [
  'webhookId',
  'triggerPath',
  'testUrl',
  'testUrlExpiresAt',
  'scheduleId',
]
