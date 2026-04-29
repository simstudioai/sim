import type { ProviderTiming, TokenInfo, ToolCall, TraceSpan } from '@/lib/logs/types'

export type { ProviderTiming, TokenInfo, ToolCall, TraceSpan }

export interface WorkflowData {
  id: string
  name: string
  description: string | null
  color: string
  state: any
}

export interface ToolCallMetadata {
  toolCalls?: ToolCall[]
}

export interface CostMetadata {
  models?: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens?: {
        input?: number
        output?: number
        prompt?: number
        completion?: number
        total?: number
      }
    }
  >
  input?: number
  output?: number
  total?: number
  tokens?: {
    input?: number
    output?: number
    prompt?: number
    completion?: number
    total?: number
  }
  pricing?: {
    input: number
    output: number
    cachedInput?: number
    updatedAt: string
  }
}

export interface WorkflowLog {
  id: string
  workflowId: string | null
  executionId?: string | null
  deploymentVersion?: number | null
  deploymentVersionName?: string | null
  level: string
  status?: string | null
  duration: string | null
  trigger: string | null
  createdAt: string
  workflow?: WorkflowData | null
  jobTitle?: string | null
  files?: Array<{
    id: string
    name: string
    size: number
    type: string
    url: string
    key: string
    uploadedAt: string
    expiresAt: string
    storageProvider?: 's3' | 'blob' | 'local'
    bucketName?: string
  }>
  cost?: CostMetadata
  hasPendingPause?: boolean
  executionData?: ToolCallMetadata & {
    traceSpans?: TraceSpan[]
    totalDuration?: number
    blockInput?: Record<string, unknown>
    enhanced?: boolean

    blockExecutions?: Array<{
      id: string
      blockId: string
      blockName: string
      blockType: string
      startedAt: string
      endedAt: string
      durationMs: number
      status: 'success' | 'error' | 'skipped'
      errorMessage?: string
      errorStackTrace?: string
      inputData: unknown
      outputData: unknown
      cost?: CostMetadata
      metadata: Record<string, unknown>
    }>
  }
}

export interface LogsResponse {
  data: WorkflowLog[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

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
