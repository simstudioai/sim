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
  'a2a',
  'copilot',
  'mothership',
  'workflow',
] as const

export type CoreTriggerType = (typeof CORE_TRIGGER_TYPES)[number]

export type TriggerType = CoreTriggerType | 'all' | (string & {})

/** Filter state for logs and dashboard views */
export interface FilterState {
  workspaceId: string
  viewMode: 'logs' | 'dashboard'
  timeRange: TimeRange
  startDate?: string
  endDate?: string
  level: LogLevel
  workflowIds: string[]
  folderIds: string[]
  searchQuery: string
  triggers: TriggerType[]
  isInitializing: boolean

  setWorkspaceId: (workspaceId: string) => void
  setViewMode: (viewMode: 'logs' | 'dashboard') => void
  setTimeRange: (timeRange: TimeRange) => void
  setDateRange: (startDate: string | undefined, endDate: string | undefined) => void
  clearDateRange: () => void
  setLevel: (level: LogLevel) => void
  setWorkflowIds: (workflowIds: string[]) => void
  toggleWorkflowId: (workflowId: string) => void
  setFolderIds: (folderIds: string[]) => void
  toggleFolderId: (folderId: string) => void
  setSearchQuery: (query: string) => void
  setTriggers: (triggers: TriggerType[]) => void
  toggleTrigger: (trigger: TriggerType) => void
  initializeFromURL: () => void
  syncWithURL: () => void
  resetFilters: () => void
}
