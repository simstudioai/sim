import type { ToolResponse } from '@/tools/types'

export interface ApifyActor {
  id: string
  name: string
  username: string
  description?: string
  stats?: {
    lastRunStartedAt?: string
  }
}

export interface RunActorParams {
  apiKey: string
  actorId: string
  input?: string
  waitForFinish?: number // For async tool: 0-60 seconds initial wait
  itemLimit?: number // For async tool: 1-250000 items, default 100
  memory?: number // Memory in MB (128-32768)
  timeout?: number
  build?: string // Actor build to run (e.g., "latest", "beta", build tag/number)
}

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
  startedAt: string
  finishedAt?: string
  defaultDatasetId: string
  defaultKeyValueStoreId: string
}

export interface RunActorResult extends ToolResponse {
  output: {
    success: boolean
    runId: string
    status: string
    datasetId?: string
    items?: any[]
    stats?: {
      inputRecords?: number
      outputRecords?: number
      duration?: number
    }
  }
}
