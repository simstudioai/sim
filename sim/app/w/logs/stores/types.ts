export interface WorkflowData {
  id: string
  name: string
  description: string | null
  color: string
  state: any
  // Add other workflow fields as needed
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
  metadata?: ToolCallMetadata | Record<string, any> // Add metadata for tool calls
}

export interface LogsResponse {
  data: WorkflowLog[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
