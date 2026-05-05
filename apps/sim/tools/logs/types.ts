import type { ExecutionSnapshotData, WorkflowLogData } from '@/lib/api/contracts/logs'
import type { ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

export interface LogsQueryParams {
  workflowIds?: string
  executionId?: string
  level?: string
  triggers?: string
  limit?: number
  startDate?: string
  endDate?: string
  search?: string
  details?: 'basic' | 'full'
  _context?: WorkflowToolExecutionContext
}

export interface LogsGetParams {
  id: string
  _context?: WorkflowToolExecutionContext
}

export interface LogsGetExecutionParams {
  executionId: string
  _context?: WorkflowToolExecutionContext
}

export interface LogsQueryResponse extends ToolResponse {
  output: {
    logs: WorkflowLogData[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export interface LogsGetResponse extends ToolResponse {
  output: {
    log: WorkflowLogData
  }
}

export interface LogsGetExecutionResponse extends ToolResponse {
  output: ExecutionSnapshotData
}
