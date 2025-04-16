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
  model?: string
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

export interface FilterState {
  // Original logs from API
  logs: WorkflowLog[]
  // Filtered logs to display
  filteredLogs: WorkflowLog[]
  // Filter states
  timeRange: TimeRange
  level: LogLevel
  workflowIds: string[]
  searchQuery: string
  // Loading state
  loading: boolean
  error: string | null
  // Actions
  setLogs: (logs: WorkflowLog[]) => void
  setTimeRange: (timeRange: TimeRange) => void
  setLevel: (level: LogLevel) => void
  setWorkflowIds: (workflowIds: string[]) => void
  toggleWorkflowId: (workflowId: string) => void
  setSearchQuery: (query: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  // Apply filters
  applyFilters: () => void
}
