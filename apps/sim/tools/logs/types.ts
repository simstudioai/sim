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

export type LogsComparisonOperator = '=' | '>' | '<' | '>=' | '<=' | '!='

export interface LogsQueryRunsParams {
  workflowIds?: string
  folderIds?: string
  level?: string
  triggers?: string
  startDate?: string
  endDate?: string
  search?: string
  costOperator?: LogsComparisonOperator
  costValue?: number
  durationOperator?: LogsComparisonOperator
  durationValue?: number
  limit?: number
  sortBy?: 'date' | 'duration' | 'cost' | 'status'
  sortOrder?: 'asc' | 'desc'
  _context?: WorkflowToolExecutionContext
}

export interface LogsGetRunDetailsParams {
  runId: string
  _context?: WorkflowToolExecutionContext
}

export interface LogsQueryResponse extends ToolResponse {
  output: {
    logs: WorkflowLogSummary[]
    nextCursor: string | null
  }
}

export interface LogsQueryRunsResponse extends ToolResponse {
  output: {
    runIds: string[]
  }
}

export interface LogsGetRunDetailsResponse extends ToolResponse {
  output: {
    runId: string
    workflowId: string | null
    workflowName: string | null
    status: string
    trigger: string | null
    startedAt: string
    durationMs: number | null
    cost: number | null
    traceSpans: unknown[]
    finalOutput: unknown
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
