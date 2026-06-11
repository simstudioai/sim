import type { ToolResponse } from '@/tools/types'

interface TriggerDevBaseParams {
  apiKey: string
}

/** Raw run object returned by the Trigger.dev list runs and retrieve run endpoints */
export interface TriggerDevApiRun {
  id: string
  status: string
  taskIdentifier: string
  version?: string
  idempotencyKey?: string
  isTest?: boolean
  createdAt?: string
  updatedAt?: string
  startedAt?: string
  finishedAt?: string
  delayedUntil?: string
  ttl?: string | number
  expiredAt?: string
  tags?: string[]
  metadata?: Record<string, unknown>
  costInCents?: number
  baseCostInCents?: number
  durationMs?: number
  depth?: number
  batchId?: string
  triggerFunction?: string
  env?: {
    id?: string
    name?: string
    user?: string
  }
}

/** Raw run detail object returned by the Trigger.dev retrieve and reschedule run endpoints */
export interface TriggerDevApiRunDetail extends TriggerDevApiRun {
  payload?: unknown
  payloadPresignedUrl?: string
  output?: unknown
  outputPresignedUrl?: string
  schedule?: {
    id?: string
    externalId?: string
    deduplicationKey?: string
    generator?: {
      type?: string
      expression?: string
      description?: string
    }
  }
  attempts?: TriggerDevApiAttempt[]
  relatedRuns?: {
    root?: TriggerDevApiRun
    parent?: TriggerDevApiRun
    children?: TriggerDevApiRun[]
  }
}

/** Raw queue object returned by the Trigger.dev queues endpoints */
export interface TriggerDevApiQueue {
  id: string
  name: string
  type?: string
  running?: number
  queued?: number
  paused?: boolean
  concurrencyLimit?: number | null
  concurrency?: {
    current?: number
    base?: number
    override?: number | null
    overriddenAt?: string | null
  }
}

/** Raw schedule object returned by the Trigger.dev schedules endpoints */
export interface TriggerDevApiSchedule {
  id: string
  task: string
  type?: string
  active?: boolean
  deduplicationKey?: string
  externalId?: string
  generator?: {
    type?: string
    expression?: string
    description?: string
  }
  timezone?: string
  nextRun?: string
  environments?: {
    id?: string
    type?: string
    userName?: string
  }[]
}

/** Raw attempt object included in the Trigger.dev retrieve run response */
export interface TriggerDevApiAttempt {
  id: string
  status: string
  createdAt?: string
  updatedAt?: string
  startedAt?: string
  completedAt?: string
  error?: {
    message?: string
    name?: string
    stackTrace?: string
  }
}

/** Normalized run fields shared by the list runs and get run outputs */
export interface TriggerDevRunSummary {
  id: string
  status: string
  taskIdentifier: string
  version: string | null
  idempotencyKey: string | null
  isTest: boolean
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  delayedUntil: string | null
  ttl: string | number | null
  expiredAt: string | null
  tags: string[]
  costInCents: number | null
  baseCostInCents: number | null
  durationMs: number | null
  env: {
    id: string | null
    name: string | null
    user: string | null
  } | null
}

/** Normalized attempt entry in the get run output */
export interface TriggerDevAttempt {
  id: string
  status: string
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  completedAt: string | null
  error: {
    message: string | null
    name: string | null
    stackTrace: string | null
  } | null
}

/** Full normalized run returned by the get run tool */
export interface TriggerDevRunDetail extends TriggerDevRunSummary {
  metadata: Record<string, unknown> | null
  depth: number | null
  batchId: string | null
  triggerFunction: string | null
  payload: unknown
  payloadPresignedUrl: string | null
  output: unknown
  outputPresignedUrl: string | null
  schedule: {
    id: string | null
    externalId: string | null
    deduplicationKey: string | null
    generator: {
      type: string | null
      expression: string | null
      description: string | null
    } | null
  } | null
  attempts: TriggerDevAttempt[]
  relatedRuns: {
    root: TriggerDevRunSummary | null
    parent: TriggerDevRunSummary | null
    children: TriggerDevRunSummary[]
  } | null
}

/** Normalized schedule returned by the schedule tools */
export interface TriggerDevSchedule {
  id: string
  task: string
  type: string | null
  active: boolean
  deduplicationKey: string | null
  externalId: string | null
  cron: string | null
  cronDescription: string | null
  timezone: string | null
  nextRun: string | null
  environments: {
    id: string | null
    type: string | null
    userName: string | null
  }[]
}

/** Normalized queue returned by the queue tools */
export interface TriggerDevQueue {
  id: string
  name: string
  type: string | null
  running: number | null
  queued: number | null
  paused: boolean
  concurrencyLimit: number | null
  concurrency: {
    current: number | null
    base: number | null
    override: number | null
    overriddenAt: string | null
  } | null
}

/** Normalized environment variable returned by the env var tools */
export interface TriggerDevEnvVar {
  name: string
  value: string
}

export interface TriggerDevTriggerTaskParams extends TriggerDevBaseParams {
  taskIdentifier: string
  payload?: string | Record<string, unknown>
  idempotencyKey?: string
  queue?: string
  concurrencyKey?: string
  delay?: string
  ttl?: string
  machine?: string
  tags?: string
}

export interface TriggerDevBatchTriggerTaskParams extends TriggerDevBaseParams {
  taskIdentifier: string
  items: string | Record<string, unknown>[]
}

export interface TriggerDevRunIdParams extends TriggerDevBaseParams {
  runId: string
}

export interface TriggerDevRescheduleRunParams extends TriggerDevBaseParams {
  runId: string
  delay: string
}

export interface TriggerDevUpdateRunMetadataParams extends TriggerDevBaseParams {
  runId: string
  metadata: string | Record<string, unknown>
}

export interface TriggerDevListRunsParams extends TriggerDevBaseParams {
  status?: string
  taskIdentifier?: string
  version?: string
  tag?: string
  schedule?: string
  isTest?: string
  period?: string
  from?: string
  to?: string
  pageSize?: number
  pageAfter?: string
  pageBefore?: string
}

export interface TriggerDevCreateScheduleParams extends TriggerDevBaseParams {
  task: string
  cron: string
  timezone?: string
  externalId?: string
  deduplicationKey?: string
}

export interface TriggerDevUpdateScheduleParams extends TriggerDevBaseParams {
  scheduleId: string
  task: string
  cron: string
  timezone?: string
  externalId?: string
}

export interface TriggerDevScheduleIdParams extends TriggerDevBaseParams {
  scheduleId: string
}

export interface TriggerDevListSchedulesParams extends TriggerDevBaseParams {
  page?: number
  perPage?: number
}

export interface TriggerDevEnvVarsScopeParams extends TriggerDevBaseParams {
  projectRef: string
  environment: string
}

export interface TriggerDevEnvVarNameParams extends TriggerDevEnvVarsScopeParams {
  name: string
}

export interface TriggerDevEnvVarWriteParams extends TriggerDevEnvVarNameParams {
  value: string
}

export interface TriggerDevQueueParams extends TriggerDevBaseParams {
  queueName: string
  queueType?: string
}

export interface TriggerDevTriggerTaskResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface TriggerDevBatchTriggerTaskResponse extends ToolResponse {
  output: {
    batchId: string
    runIds: string[]
  }
}

export interface TriggerDevUpdateRunMetadataResponse extends ToolResponse {
  output: {
    metadata: Record<string, unknown> | null
  }
}

export interface TriggerDevListEnvVarsResponse extends ToolResponse {
  output: {
    variables: TriggerDevEnvVar[]
  }
}

export interface TriggerDevEnvVarResponse extends ToolResponse {
  output: TriggerDevEnvVar
}

export interface TriggerDevEnvVarActionResponse extends ToolResponse {
  output: {
    success: boolean
    name: string
  }
}

export interface TriggerDevQueueResponse extends ToolResponse {
  output: TriggerDevQueue
}

export interface TriggerDevRunResponse extends ToolResponse {
  output: TriggerDevRunDetail
}

export interface TriggerDevListRunsResponse extends ToolResponse {
  output: {
    runs: TriggerDevRunSummary[]
    pagination: {
      next: string | null
      previous: string | null
    }
  }
}

export interface TriggerDevRunActionResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface TriggerDevScheduleResponse extends ToolResponse {
  output: TriggerDevSchedule
}

export interface TriggerDevListSchedulesResponse extends ToolResponse {
  output: {
    schedules: TriggerDevSchedule[]
    pagination: {
      currentPage: number | null
      totalPages: number | null
      count: number | null
    }
  }
}

export interface TriggerDevDeleteScheduleResponse extends ToolResponse {
  output: {
    deleted: boolean
    scheduleId: string
  }
}

export type TriggerDevResponse =
  | TriggerDevTriggerTaskResponse
  | TriggerDevBatchTriggerTaskResponse
  | TriggerDevRunResponse
  | TriggerDevListRunsResponse
  | TriggerDevRunActionResponse
  | TriggerDevUpdateRunMetadataResponse
  | TriggerDevScheduleResponse
  | TriggerDevListSchedulesResponse
  | TriggerDevDeleteScheduleResponse
  | TriggerDevListEnvVarsResponse
  | TriggerDevEnvVarResponse
  | TriggerDevEnvVarActionResponse
  | TriggerDevQueueResponse
