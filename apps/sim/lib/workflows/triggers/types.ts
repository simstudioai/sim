/**
 * Unified trigger type definitions. Kept dependency-free so callers that only need the
 * constants (e.g. execution file handling in background tasks) never load the block registry.
 */
export const TRIGGER_TYPES = {
  INPUT: 'input_trigger',
  MANUAL: 'manual_trigger',
  CHAT: 'chat_trigger',
  API: 'api_trigger',
  WEBHOOK: 'webhook',
  GENERIC_WEBHOOK: 'generic_webhook',
  SCHEDULE: 'schedule',
  SIM: 'sim_workspace_event',
  START: 'start_trigger',
  STARTER: 'starter', // Legacy
} as const

export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES]
