export interface WorkflowData {
  id: string
  name: string
  description: string | null
  color: string
  state: any
  // Add other workflow fields as needed
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
}

export interface LogsResponse {
  data: WorkflowLog[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
