import type { Edge } from 'reactflow'
import type { BlockLog, NormalizedBlockOutput } from '@/executor/types'
import type { DeploymentStatus } from '@/stores/workflows/registry/types'
import type { Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

export type { WorkflowState, Loop, Parallel, DeploymentStatus }
export type WorkflowEdge = Edge
export type { NormalizedBlockOutput, BlockLog }

export interface PricingInfo {
  input: number
  output: number
  cachedInput?: number
  updatedAt: string
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface CostBreakdown {
  input: number
  output: number
  total: number
  tokens: TokenUsage
  model: string
  pricing: PricingInfo
}

export interface ToolCall {
  name: string
  duration: number
  startTime: string
  endTime: string
  status: 'success' | 'error'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
}

export type BlockInputData = Record<string, any>
export type BlockOutputData = NormalizedBlockOutput | null

export interface ExecutionEnvironment {
  variables: Record<string, string>
  workflowId: string
  executionId: string
  userId: string
  workspaceId: string
}

export interface ExecutionTrigger {
  type: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  source: string
  data?: Record<string, unknown>
  timestamp: string
}

export interface ExecutionStatus {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  endedAt?: string
  durationMs?: number
}

export interface WorkflowExecutionSnapshot {
  id: string
  workflowId: string
  stateHash: string
  stateData: WorkflowState
  createdAt: string
}

export type WorkflowExecutionSnapshotInsert = Omit<WorkflowExecutionSnapshot, 'createdAt'>
export type WorkflowExecutionSnapshotSelect = WorkflowExecutionSnapshot

export interface WorkflowExecutionLog {
  id: string
  workflowId: string
  executionId: string
  stateSnapshotId: string
  level: 'info' | 'error'
  trigger: ExecutionTrigger['type']
  startedAt: string
  endedAt: string
  totalDurationMs: number
  files?: Array<{
    id: string
    name: string
    size: number
    type: string
    url: string
    key: string
  }>
  // Execution details
  executionData: {
    environment?: ExecutionEnvironment
    trigger?: ExecutionTrigger
    traceSpans?: TraceSpan[]
    errorDetails?: {
      blockId: string
      blockName: string
      error: string
      stackTrace?: string
    }
  }
  // Top-level cost information
  cost?: {
    input?: number
    output?: number
    total?: number
    tokens?: { prompt?: number; completion?: number; total?: number }
    models?: Record<
      string,
      {
        input?: number
        output?: number
        total?: number
        tokens?: { prompt?: number; completion?: number; total?: number }
      }
    >
  }
  duration?: string
  createdAt: string
}

export type WorkflowExecutionLogInsert = Omit<WorkflowExecutionLog, 'id' | 'createdAt'>
export type WorkflowExecutionLogSelect = WorkflowExecutionLog

export interface TokenInfo {
  input?: number
  output?: number
  total?: number
  prompt?: number
  completion?: number
}

export interface ProviderTiming {
  duration: number
  startTime: string
  endTime: string
  segments: Array<{
    type: string
    name?: string
    startTime: string | number
    endTime: string | number
    duration: number
  }>
}

export interface TraceSpan {
  id: string
  name: string
  type: string
  duration: number
  startTime: string
  endTime: string
  children?: TraceSpan[]
  toolCalls?: ToolCall[]
  status?: 'success' | 'error'
  tokens?: number | TokenInfo
  relativeStartMs?: number
  blockId?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  model?: string
  cost?: {
    input?: number
    output?: number
    total?: number
  }
  providerTiming?: ProviderTiming
  loopId?: string
  parallelId?: string
  iterationIndex?: number
}

export interface WorkflowExecutionSummary {
  id: string
  workflowId: string
  workflowName: string
  executionId: string
  trigger: ExecutionTrigger['type']
  status: ExecutionStatus['status']
  startedAt: string
  endedAt: string
  durationMs: number

  costSummary: {
    total: number
    inputCost: number
    outputCost: number
    tokens: number
  }
  stateSnapshotId: string
  errorSummary?: {
    blockId: string
    blockName: string
    message: string
  }
}

export interface WorkflowExecutionDetail extends WorkflowExecutionSummary {
  environment: ExecutionEnvironment
  triggerData: ExecutionTrigger
  blockExecutions: BlockExecutionSummary[]
  traceSpans: TraceSpan[]
  workflowState: WorkflowState
}

export interface BlockExecutionSummary {
  id: string
  blockId: string
  blockName: string
  blockType: string
  startedAt: string
  endedAt: string
  durationMs: number
  status: 'success' | 'error' | 'skipped'
  errorMessage?: string
  cost?: CostBreakdown
  inputSummary: {
    parameterCount: number
    hasComplexData: boolean
  }
  outputSummary: {
    hasOutput: boolean
    outputType: string
    hasError: boolean
  }
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrevious: boolean
  }
}

export type WorkflowExecutionsResponse = PaginatedResponse<WorkflowExecutionSummary>
export type BlockExecutionsResponse = PaginatedResponse<BlockExecutionSummary>

export interface WorkflowExecutionFilters {
  workflowIds?: string[]
  folderIds?: string[]
  triggers?: ExecutionTrigger['type'][]
  status?: ExecutionStatus['status'][]
  startDate?: string
  endDate?: string
  search?: string
  minDuration?: number
  maxDuration?: number
  minCost?: number
  maxCost?: number
  hasErrors?: boolean
}

export interface PaginationParams {
  page: number
  pageSize: number
  sortBy?: 'startedAt' | 'durationMs' | 'totalCost' | 'blockCount'
  sortOrder?: 'asc' | 'desc'
}

export interface LogsQueryParams extends WorkflowExecutionFilters, PaginationParams {
  includeBlockSummary?: boolean
  includeWorkflowState?: boolean
}

export interface LogsError {
  code: 'EXECUTION_NOT_FOUND' | 'SNAPSHOT_NOT_FOUND' | 'INVALID_WORKFLOW_STATE' | 'STORAGE_ERROR'
  message: string
  details?: Record<string, unknown>
}

export interface ValidationError {
  field: string
  message: string
  value: unknown
}

export class LogsServiceError extends Error {
  public code: LogsError['code']
  public details?: Record<string, unknown>

  constructor(message: string, code: LogsError['code'], details?: Record<string, unknown>) {
    super(message)
    this.name = 'LogsServiceError'
    this.code = code
    this.details = details
  }
}

export interface DatabaseOperationResult<T> {
  success: boolean
  data?: T
  error?: LogsServiceError
}

export interface BatchInsertResult<T> {
  inserted: T[]
  failed: Array<{
    item: T
    error: string
  }>
  totalAttempted: number
  totalSucceeded: number
  totalFailed: number
}

export interface SnapshotService {
  createSnapshot(workflowId: string, state: WorkflowState): Promise<WorkflowExecutionSnapshot>
  getSnapshot(id: string): Promise<WorkflowExecutionSnapshot | null>
  getSnapshotByHash(workflowId: string, hash: string): Promise<WorkflowExecutionSnapshot | null>
  computeStateHash(state: WorkflowState): string
  cleanupOrphanedSnapshots(olderThanDays: number): Promise<number>
}

export interface SnapshotCreationResult {
  snapshot: WorkflowExecutionSnapshot
  isNew: boolean
}

export interface ExecutionLoggerService {
  startWorkflowExecution(params: {
    workflowId: string
    executionId: string
    trigger: ExecutionTrigger
    environment: ExecutionEnvironment
    workflowState: WorkflowState
  }): Promise<{
    workflowLog: WorkflowExecutionLog
    snapshot: WorkflowExecutionSnapshot
  }>

  completeWorkflowExecution(params: {
    executionId: string
    endedAt: string
    totalDurationMs: number

    costSummary: {
      totalCost: number
      totalInputCost: number
      totalOutputCost: number
      totalTokens: number
    }
    finalOutput: BlockOutputData
    traceSpans?: TraceSpan[]
  }): Promise<WorkflowExecutionLog>
}
