import type { ToolResponse } from '@/tools/types'

/** Apify actor run object returned by the run/status endpoints. */
export interface ApifyRun {
  id: string
  actId: string
  status:
    | 'READY'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'ABORTED'
    | 'TIMED-OUT'
    | 'ABORTING'
    | 'TIMING-OUT'
  startedAt?: string
  finishedAt?: string
  defaultDatasetId?: string
  defaultKeyValueStoreId?: string
  stats?: Record<string, unknown>
}

export interface RunActorParams {
  apiKey: string
  actorId: string
  input?: string
  waitForFinish?: number // For async tool: 0-60 seconds initial wait
  itemLimit?: number // For async tool: 1-250000 items, default 100
  memory?: number // Memory in MB (128-32768)
  timeout?: number // Timeout in seconds
  build?: string // Actor build to run (e.g., "latest", "beta", build tag/number)
}

export interface RunActorResult extends ToolResponse {
  output: {
    success: boolean
    runId: string
    status: string
    datasetId?: string
    items?: unknown[]
  }
}

export interface RunTaskParams {
  apiKey: string
  taskId: string
  input?: string
  memory?: number
  timeout?: number
  build?: string
  itemLimit?: number
}

export interface RunTaskResult extends ToolResponse {
  output: {
    success: boolean
    status: string
    items: unknown[]
  }
}

export interface GetDatasetItemsParams {
  apiKey: string
  datasetId: string
  itemLimit?: number
  offset?: number
  fields?: string
}

export interface GetDatasetItemsResult extends ToolResponse {
  output: {
    success: boolean
    datasetId: string
    items: unknown[]
    count: number
  }
}

export interface GetRunParams {
  apiKey: string
  runId: string
}

export interface GetRunResult extends ToolResponse {
  output: {
    success: boolean
    runId: string
    status: string
    startedAt: string | null
    finishedAt: string | null
    datasetId: string | null
    keyValueStoreId: string | null
    stats: Record<string, unknown> | null
  }
}
