import type { ToolResponse } from '@/tools/types'

export interface TemporalBaseParams {
  serverUrl: string
  namespace: string
  apiKey?: string
}

export interface TemporalExecutionSummary {
  workflowId: string | null
  runId: string | null
  workflowType: string | null
  status: string | null
  startTime: string | null
  closeTime: string | null
  executionTime: string | null
  historyLength: number | null
  taskQueue: string | null
}

export interface TemporalPendingActivity {
  activityId: string | null
  activityType: string | null
  state: string | null
  attempt: number | null
  lastFailureMessage: string | null
}

export interface TemporalHistoryEventSummary {
  eventId: number | null
  eventTime: string | null
  eventType: string | null
  attributes: Record<string, unknown> | null
}

export interface TemporalStartWorkflowParams extends TemporalBaseParams {
  workflowId: string
  workflowType: string
  taskQueue: string
  input?: string
  workflowIdReusePolicy?: string
  workflowIdConflictPolicy?: string
  cronSchedule?: string
  executionTimeoutSeconds?: number
  runTimeoutSeconds?: number
  memo?: string
  searchAttributes?: string
}

export interface TemporalStartWorkflowResponse extends ToolResponse {
  output: {
    workflowId: string
    runId: string
    started: boolean
  }
}

export interface TemporalSignalWorkflowParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
  signalName: string
  signalInput?: string
}

export interface TemporalSignalWorkflowResponse extends ToolResponse {
  output: {
    workflowId: string
    signalName: string
  }
}

export interface TemporalSignalWithStartParams extends TemporalBaseParams {
  workflowId: string
  workflowType: string
  taskQueue: string
  signalName: string
  input?: string
  signalInput?: string
  workflowIdReusePolicy?: string
  workflowIdConflictPolicy?: string
  cronSchedule?: string
  executionTimeoutSeconds?: number
  runTimeoutSeconds?: number
  memo?: string
  searchAttributes?: string
}

export interface TemporalSignalWithStartResponse extends ToolResponse {
  output: {
    workflowId: string
    runId: string
    started: boolean
  }
}

export interface TemporalQueryWorkflowParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
  queryType: string
  queryArgs?: string
}

export interface TemporalQueryWorkflowResponse extends ToolResponse {
  output: {
    workflowId: string
    queryType: string
    result: unknown
  }
}

export interface TemporalDescribeWorkflowParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
}

export interface TemporalDescribeWorkflowResponse extends ToolResponse {
  output: TemporalExecutionSummary & {
    memo: Record<string, unknown> | null
    searchAttributes: Record<string, unknown> | null
    pendingActivities: TemporalPendingActivity[]
  }
}

export interface TemporalListWorkflowsParams extends TemporalBaseParams {
  query?: string
  pageSize?: number
  nextPageToken?: string
}

export interface TemporalListWorkflowsResponse extends ToolResponse {
  output: {
    executions: TemporalExecutionSummary[]
    nextPageToken: string | null
  }
}

export interface TemporalGetWorkflowHistoryParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
  maximumPageSize?: number
  nextPageToken?: string
  historyEventFilterType?: string
}

export interface TemporalGetWorkflowHistoryResponse extends ToolResponse {
  output: {
    events: TemporalHistoryEventSummary[]
    nextPageToken: string | null
  }
}

export interface TemporalUpdateWorkflowParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
  updateName: string
  updateArgs?: string
}

export interface TemporalUpdateWorkflowResponse extends ToolResponse {
  output: {
    workflowId: string
    updateName: string
    result: unknown
  }
}

export interface TemporalCountWorkflowsParams extends TemporalBaseParams {
  query?: string
}

export interface TemporalCountWorkflowsResponse extends ToolResponse {
  output: {
    count: number
    groups: Array<{ values: unknown[]; count: number }>
  }
}

export interface TemporalResetWorkflowParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
  workflowTaskFinishEventId: number
  reason?: string
}

export interface TemporalResetWorkflowResponse extends ToolResponse {
  output: {
    workflowId: string
    runId: string
  }
}

export interface TemporalScheduleSummary {
  scheduleId: string | null
  workflowType: string | null
  paused: boolean
  notes: string | null
  futureActionTimes: string[]
}

export interface TemporalListSchedulesParams extends TemporalBaseParams {
  query?: string
  maximumPageSize?: number
  nextPageToken?: string
}

export interface TemporalListSchedulesResponse extends ToolResponse {
  output: {
    schedules: TemporalScheduleSummary[]
    nextPageToken: string | null
  }
}

export interface TemporalDescribeScheduleParams extends TemporalBaseParams {
  scheduleId: string
}

export interface TemporalDescribeScheduleResponse extends ToolResponse {
  output: {
    scheduleId: string
    paused: boolean
    notes: string | null
    workflowType: string | null
    taskQueue: string | null
    workflowId: string | null
    spec: Record<string, unknown> | null
    recentActions: Array<{
      scheduleTime: string | null
      actualTime: string | null
      workflowId: string | null
      runId: string | null
    }>
    futureActionTimes: string[]
  }
}

export interface TemporalPatchScheduleParams extends TemporalBaseParams {
  scheduleId: string
  reason?: string
}

export interface TemporalTriggerScheduleParams extends TemporalBaseParams {
  scheduleId: string
  overlapPolicy?: string
}

export interface TemporalScheduleMutationResponse extends ToolResponse {
  output: {
    scheduleId: string
  }
}

export interface TemporalCreateScheduleParams extends TemporalBaseParams {
  scheduleId: string
  workflowId: string
  workflowType: string
  taskQueue: string
  input?: string
  cronExpressions?: string
  intervalSeconds?: number
  timezone?: string
  overlapPolicy?: string
  notes?: string
  paused?: boolean
}

export interface TemporalDeleteScheduleParams extends TemporalBaseParams {
  scheduleId: string
}

export interface TemporalDescribeTaskQueueParams extends TemporalBaseParams {
  taskQueue: string
  taskQueueType?: string
}

export interface TemporalDescribeTaskQueueResponse extends ToolResponse {
  output: {
    taskQueue: string
    pollers: Array<{
      identity: string | null
      lastAccessTime: string | null
      ratePerSecond: number | null
    }>
  }
}

export interface TemporalCancelWorkflowParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
  reason?: string
}

export interface TemporalCancelWorkflowResponse extends ToolResponse {
  output: {
    workflowId: string
  }
}

export interface TemporalTerminateWorkflowParams extends TemporalBaseParams {
  workflowId: string
  runId?: string
  reason?: string
}

export interface TemporalTerminateWorkflowResponse extends ToolResponse {
  output: {
    workflowId: string
  }
}

export type TemporalResponse =
  | TemporalStartWorkflowResponse
  | TemporalSignalWorkflowResponse
  | TemporalSignalWithStartResponse
  | TemporalQueryWorkflowResponse
  | TemporalUpdateWorkflowResponse
  | TemporalDescribeWorkflowResponse
  | TemporalListWorkflowsResponse
  | TemporalCountWorkflowsResponse
  | TemporalGetWorkflowHistoryResponse
  | TemporalCancelWorkflowResponse
  | TemporalTerminateWorkflowResponse
  | TemporalResetWorkflowResponse
  | TemporalListSchedulesResponse
  | TemporalDescribeScheduleResponse
  | TemporalScheduleMutationResponse
  | TemporalDescribeTaskQueueResponse
