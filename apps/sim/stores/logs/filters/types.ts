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

export type LogLevel =
  | 'error'
  | 'info'
  | 'running'
  | 'pending'
  | 'cancelled'
  | 'all'
  | (string & {})

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
  'form',
] as const

export type CoreTriggerType = (typeof CORE_TRIGGER_TYPES)[number]

export type TriggerType = CoreTriggerType | 'all' | (string & {})

export type LogViewMode = 'logs' | 'dashboard'

/**
 * Non-URL logs view state. The filter state itself (time range, level,
 * workflows, folders, triggers, search) lives in the URL via nuqs
 * (`useLogFilters`); only the view-mode toggle is kept in this store.
 */
export interface LogViewState {
  viewMode: LogViewMode
  setViewMode: (viewMode: LogViewMode) => void
}
