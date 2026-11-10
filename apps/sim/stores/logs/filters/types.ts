export type TimeRange =
  | 'Past 30 minutes'
  | 'Past hour'
  | 'Past 6 hours'
  | 'Past 12 hours'
  | 'Past 24 hours'
  | 'Past 3 days'
  | 'Past 7 days'
  | 'Past 14 days'
  | 'Past 30 days'
  | 'All time'
  | 'Custom range'

/** Core trigger types for workflow execution */
export const CORE_TRIGGER_TYPES = [
  'manual',
  'api',
  'schedule',
  'chat',
  'webhook',
  'mcp',
  'copilot',
  'mothership',
  'workflow',
  'custom_block',
  'test',
] as const

export type CoreTriggerType = (typeof CORE_TRIGGER_TYPES)[number]
