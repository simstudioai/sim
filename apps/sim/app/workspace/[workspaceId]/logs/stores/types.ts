export interface WorkflowData {
  id: string
  name: string
  description: string | null
  color: string
  state: any
}

export interface ToolCall {
  name: string
  duration: number // in milliseconds
  startTime: string // ISO timestamp
  endTime: string // ISO timestamp
  status: 'success' | 'error' // Status of the tool call
  input?: Record<string, any> // Input parameters (optional)
  output?: Record<string, any> // Output data (optional)
  error?: string // Error message if status is 'error'
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

export interface TraceSpan {
  id: string
  name: string
  type: string
  duration: number // in milliseconds
  startTime: string
  endTime: string
  children?: TraceSpan[]
  toolCalls?: ToolCall[]
  status?: 'success' | 'error'
  tokens?: number
  relativeStartMs?: number // Time in ms from the start of the parent span
  blockId?: string // Added to track the original block ID for relationship mapping
  input?: Record<string, any> // Added to store input data for this span
  output?: Record<string, any> // Added to store output data for this span
}

export interface WorkflowLog {
  id: string
  workflowId: string
  executionId: string | null
  level: string
  message: string
  duration: string | null
  trigger: string | null
  createdAt: string
  workflow?: WorkflowData | null
  metadata?: ToolCallMetadata & {
    traceSpans?: TraceSpan[]
    totalDuration?: number
    cost?: CostMetadata
    blockInput?: Record<string, any>
    enhanced?: boolean
    blockStats?: {
      total: number
      success: number
      error: number
      skipped: number
    }
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
      inputData: any
      outputData: any
      cost?: CostMetadata
      metadata: any
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

export type TimeRange = 'Past 30 minutes' | 'Past hour' | 'Past 24 hours' | 'All time'
export type LogLevel = 'error' | 'info' | 'all'
export type TriggerType = 'chat' | 'api' | 'webhook' | 'manual' | 'schedule' | 'all'

export interface FilterState {
  // Original logs from API
  logs: WorkflowLog[]

  // Filter states
  timeRange: TimeRange
  level: LogLevel
  workflowIds: string[]
  folderIds: string[]
  searchQuery: string
  triggers: TriggerType[]

  // Loading state
  loading: boolean
  error: string | null

  // Pagination state
  page: number
  hasMore: boolean
  isFetchingMore: boolean

  // Actions
  setLogs: (logs: WorkflowLog[], append?: boolean) => void
  setTimeRange: (timeRange: TimeRange) => void
  setLevel: (level: LogLevel) => void
  setWorkflowIds: (workflowIds: string[]) => void
  toggleWorkflowId: (workflowId: string) => void
  setFolderIds: (folderIds: string[]) => void
  toggleFolderId: (folderId: string) => void
  setSearchQuery: (query: string) => void
  setTriggers: (triggers: TriggerType[]) => void
  toggleTrigger: (trigger: TriggerType) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setPage: (page: number) => void
  setHasMore: (hasMore: boolean) => void
  setIsFetchingMore: (isFetchingMore: boolean) => void
  resetPagination: () => void

  // Build query parameters for server-side filtering
  buildQueryParams: (page: number, limit: number) => string
}
