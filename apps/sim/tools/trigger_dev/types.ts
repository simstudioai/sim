import type { ToolResponse } from '@/tools/types'

export interface TriggerDevBaseParams {
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

/** Raw run result object returned by the run result and batch results endpoints */
export interface TriggerDevApiRunResult {
  ok: boolean
  id: string
  taskIdentifier?: string
  output?: string
  outputType?: string
  error?: Record<string, unknown>
  usage?: {
    durationMs?: number
  }
}

/** Normalized run result returned by the run result and batch results tools */
export interface TriggerDevRunResult {
  ok: boolean
  id: string
  taskIdentifier: string | null
  output: unknown
  outputType: string | null
  error: Record<string, unknown> | null
  durationMs: number | null
}

/** Span event entry attached to a run event or trace span */
export interface TriggerDevSpanEvent {
  name: string | null
  time: string | null
  properties: Record<string, unknown> | null
}

/** Normalized run event returned by the run events tool */
export interface TriggerDevRunEvent {
  spanId: string | null
  parentId: string | null
  runId: string | null
  message: string | null
  startTime: string | null
  duration: number | null
  isError: boolean
  isPartial: boolean
  isCancelled: boolean
  level: string | null
  kind: string | null
  attemptNumber: number | null
  taskSlug: string | null
  events: TriggerDevSpanEvent[]
}

/** Raw deployment object returned by the deployments endpoints */
export interface TriggerDevApiDeployment {
  id: string
  status: string
  createdAt?: string
  shortCode?: string
  version?: string
  runtime?: string | null
  runtimeVersion?: string | null
  deployedAt?: string | null
  git?: Record<string, unknown> | null
  error?: Record<string, unknown> | null
  contentHash?: string
  imageReference?: string | null
  errorData?: Record<string, unknown> | null
  worker?: {
    id?: string
    version?: string
    tasks?: {
      id?: string
      slug?: string
      filePath?: string
    }[]
  } | null
}

/** Normalized deployment returned by the deployment tools */
export interface TriggerDevDeployment {
  id: string
  status: string
  version: string | null
  shortCode: string | null
  createdAt: string | null
  deployedAt: string | null
  runtime: string | null
  runtimeVersion: string | null
  git: Record<string, unknown> | null
  error: Record<string, unknown> | null
  tasks: {
    id: string | null
    slug: string | null
    filePath: string | null
  }[]
}

/** Raw waitpoint token object returned by the waitpoint endpoints */
export interface TriggerDevApiWaitpointToken {
  id: string
  url: string
  status: string
  idempotencyKey?: string | null
  idempotencyKeyExpiresAt?: string | null
  timeoutAt?: string | null
  completedAt?: string | null
  output?: string | null
  outputType?: string | null
  outputIsError?: boolean | null
  tags?: string[]
  createdAt?: string
}

/** Normalized waitpoint token returned by the waitpoint tools */
export interface TriggerDevWaitpointToken {
  id: string
  url: string
  status: string
  idempotencyKey: string | null
  idempotencyKeyExpiresAt: string | null
  timeoutAt: string | null
  completedAt: string | null
  output: unknown
  outputType: string | null
  outputIsError: boolean
  tags: string[]
  createdAt: string | null
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

export interface TriggerDevAddRunTagsParams extends TriggerDevBaseParams {
  runId: string
  tags: string
}

export interface TriggerDevBatchIdParams extends TriggerDevBaseParams {
  batchId: string
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
  deduplicationKey: string
  timezone?: string
  externalId?: string
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

export interface TriggerDevImportEnvVarsParams extends TriggerDevEnvVarsScopeParams {
  variables: string | Record<string, unknown>[]
  override?: string
}

export interface TriggerDevQueueParams extends TriggerDevBaseParams {
  queueName: string
  queueType?: string
}

export interface TriggerDevListQueuesParams extends TriggerDevBaseParams {
  page?: number
  perPage?: number
}

export interface TriggerDevOverrideQueueConcurrencyParams extends TriggerDevQueueParams {
  concurrencyLimit: number
}

export interface TriggerDevListDeploymentsParams extends TriggerDevBaseParams {
  status?: string
  period?: string
  from?: string
  to?: string
  pageSize?: number
  pageAfter?: string
}

export interface TriggerDevGetDeploymentParams extends TriggerDevBaseParams {
  deploymentId: string
}

export interface TriggerDevPromoteDeploymentParams extends TriggerDevBaseParams {
  version: string
}

export interface TriggerDevExecuteQueryParams extends TriggerDevBaseParams {
  query: string
  scope?: string
  period?: string
  from?: string
  to?: string
  format?: string
}

export interface TriggerDevCreateWaitpointTokenParams extends TriggerDevBaseParams {
  timeout?: string
  idempotencyKey?: string
  idempotencyKeyTTL?: string
  tags?: string
}

export interface TriggerDevWaitpointIdParams extends TriggerDevBaseParams {
  waitpointId: string
}

export interface TriggerDevCompleteWaitpointTokenParams extends TriggerDevBaseParams {
  waitpointId: string
  data?: string | Record<string, unknown>
}

export interface TriggerDevListWaitpointTokensParams extends TriggerDevBaseParams {
  status?: string
  idempotencyKey?: string
  tags?: string
  period?: string
  from?: string
  to?: string
  pageSize?: number
  pageAfter?: string
  pageBefore?: string
}

export interface TriggerDevListTimezonesParams extends TriggerDevBaseParams {
  excludeUtc?: string
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

/** Normalized batch returned by the get batch tool */
export interface TriggerDevBatch {
  id: string
  status: string
  idempotencyKey: string | null
  createdAt: string | null
  updatedAt: string | null
  runCount: number | null
  runIds: string[]
  successfulRunCount: number | null
  failedRunCount: number | null
  errors:
    | {
        index: number | null
        taskIdentifier: string | null
        error: Record<string, unknown> | null
        errorCode: string | null
      }[]
    | null
}

export interface TriggerDevGetBatchResponse extends ToolResponse {
  output: TriggerDevBatch
}

export interface TriggerDevBatchResultsResponse extends ToolResponse {
  output: {
    id: string
    items: TriggerDevRunResult[]
  }
}

export interface TriggerDevRunResultResponse extends ToolResponse {
  output: TriggerDevRunResult
}

export interface TriggerDevAddRunTagsResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface TriggerDevRunEventsResponse extends ToolResponse {
  output: {
    events: TriggerDevRunEvent[]
  }
}

export interface TriggerDevRunTraceResponse extends ToolResponse {
  output: {
    traceId: string | null
    rootSpan: Record<string, unknown> | null
  }
}

export interface TriggerDevListQueuesResponse extends ToolResponse {
  output: {
    queues: TriggerDevQueue[]
    pagination: {
      currentPage: number | null
      totalPages: number | null
      count: number | null
    }
  }
}

export interface TriggerDevDeploymentResponse extends ToolResponse {
  output: TriggerDevDeployment
}

export interface TriggerDevListDeploymentsResponse extends ToolResponse {
  output: {
    deployments: TriggerDevDeployment[]
    pagination: {
      next: string | null
    }
  }
}

export interface TriggerDevPromoteDeploymentResponse extends ToolResponse {
  output: {
    id: string
    version: string | null
    shortCode: string | null
  }
}

export interface TriggerDevExecuteQueryResponse extends ToolResponse {
  output: {
    format: string
    results: unknown
  }
}

export interface TriggerDevQuerySchemaResponse extends ToolResponse {
  output: {
    tables: {
      name: string | null
      description: string | null
      timeColumn: string | null
      columns: {
        name: string | null
        type: string | null
        description: string | null
        example: string | null
        allowedValues: string[]
        coreColumn: boolean
      }[]
    }[]
  }
}

export interface TriggerDevCreateWaitpointTokenResponse extends ToolResponse {
  output: {
    id: string
    isCached: boolean
    url: string
  }
}

export interface TriggerDevCompleteWaitpointTokenResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface TriggerDevWaitpointTokenResponse extends ToolResponse {
  output: TriggerDevWaitpointToken
}

export interface TriggerDevListWaitpointTokensResponse extends ToolResponse {
  output: {
    tokens: TriggerDevWaitpointToken[]
    pagination: {
      next: string | null
      previous: string | null
    }
  }
}

export interface TriggerDevImportEnvVarsResponse extends ToolResponse {
  output: {
    success: boolean
    count: number
  }
}

export interface TriggerDevListTimezonesResponse extends ToolResponse {
  output: {
    timezones: string[]
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
  | TriggerDevGetBatchResponse
  | TriggerDevBatchResultsResponse
  | TriggerDevRunResponse
  | TriggerDevRunResultResponse
  | TriggerDevListRunsResponse
  | TriggerDevRunActionResponse
  | TriggerDevAddRunTagsResponse
  | TriggerDevRunEventsResponse
  | TriggerDevRunTraceResponse
  | TriggerDevUpdateRunMetadataResponse
  | TriggerDevScheduleResponse
  | TriggerDevListSchedulesResponse
  | TriggerDevDeleteScheduleResponse
  | TriggerDevListEnvVarsResponse
  | TriggerDevEnvVarResponse
  | TriggerDevEnvVarActionResponse
  | TriggerDevImportEnvVarsResponse
  | TriggerDevQueueResponse
  | TriggerDevListQueuesResponse
  | TriggerDevDeploymentResponse
  | TriggerDevListDeploymentsResponse
  | TriggerDevPromoteDeploymentResponse
  | TriggerDevExecuteQueryResponse
  | TriggerDevQuerySchemaResponse
  | TriggerDevCreateWaitpointTokenResponse
  | TriggerDevCompleteWaitpointTokenResponse
  | TriggerDevWaitpointTokenResponse
  | TriggerDevListWaitpointTokensResponse
  | TriggerDevListTimezonesResponse
