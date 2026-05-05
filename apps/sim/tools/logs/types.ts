import type {
  ExecutionSnapshotData,
  WorkflowLogDetail,
  WorkflowLogSummary,
} from '@/lib/api/contracts/logs'
import type { ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

export interface LogsQueryParams {
  workflowIds?: string
  executionId?: string
  level?: string
  triggers?: string
  limit?: number
  cursor?: string
  sortBy?: 'date' | 'duration' | 'cost' | 'status'
  sortOrder?: 'asc' | 'desc'
  startDate?: string
  endDate?: string
  search?: string
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
    logs: WorkflowLogSummary[]
    nextCursor: string | null
  }
}

export interface LogsGetResponse extends ToolResponse {
  output: {
    log: WorkflowLogDetail
  }
}

export interface LogsGetExecutionResponse extends ToolResponse {
  output: ExecutionSnapshotData
}
