import type { ToolResponse } from '@/tools/types'

/**
 * Outbound fetch deadline (milliseconds) for the two `run-sync-get-dataset-items`
 * endpoints.
 *
 * Apify documents that "If the Actor run exceeds 300 seconds, the HTTP response
 * will return the 408 status code (Request Timeout)" on both the actor and the
 * actor-task variant. Sim's own transport falls back to `options.timeout || 300000`
 * in `lib/core/security/input-validation.server.ts` — the same number — so a run
 * that lands on the boundary is a race between Apify's structured 408 and a
 * generic `Request timed out after 300000ms` that names neither the actor nor the
 * reason.
 *
 * This is a deliberate fixed clamp, not the user's `actorTimeout`/`taskTimeout`
 * seconds value reinterpreted as milliseconds: the endpoint caps every sync run at
 * 300s regardless of the run timeout asked for, so the only budget the transport
 * needs is 300s plus the cost of the round trip around it — connection setup, the
 * run being queued, and transferring a dataset body that may reach the 10MB tool
 * response cap. 30s of headroom matches `INTERNAL_ROUTE_TRANSPORT_OVERHEAD_MS` in
 * `tools/index.ts`, which exists for the same reason, and keeps the value far
 * below `getMaxExecutionTimeout()` (which clamps it anyway).
 */
export const APIFY_SYNC_TRANSPORT_TIMEOUT_MS = 330_000

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
  actorTimeout?: number // Timeout in seconds
  build?: string // Actor build to run (e.g., "latest", "beta", build tag/number)
}

export interface RunActorResult extends ToolResponse {
  output: {
    success: boolean
    /** Absent for the sync endpoint, whose response carries no run identifier. */
    runId?: string
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
  taskTimeout?: number
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
