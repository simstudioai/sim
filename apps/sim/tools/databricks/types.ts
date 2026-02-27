import type { ToolResponse } from '@/tools/types'

/** Base parameters shared by all Databricks tools */
export interface DatabricksBaseParams {
  apiKey: string
  host: string
}

/** Execute SQL Statement */
export interface DatabricksExecuteSqlParams extends DatabricksBaseParams {
  warehouseId: string
  statement: string
  catalog?: string
  schema?: string
  rowLimit?: number
  waitTimeout?: string
}

export interface DatabricksExecuteSqlResponse extends ToolResponse {
  output: {
    statementId: string
    status: string
    columns: Array<{ name: string; position: number; typeName: string }> | null
    data: string[][] | null
    totalRows: number | null
    truncated: boolean
  }
}

/** List Jobs */
export interface DatabricksListJobsParams extends DatabricksBaseParams {
  limit?: number
  offset?: number
  name?: string
  expandTasks?: boolean
}

export interface DatabricksListJobsResponse extends ToolResponse {
  output: {
    jobs: Array<{
      jobId: number
      name: string
      createdTime: number
      creatorUserName: string
      maxConcurrentRuns: number
      format: string
    }>
    hasMore: boolean
    nextPageToken: string | null
  }
}

/** Run Job */
export interface DatabricksRunJobParams extends DatabricksBaseParams {
  jobId: number
  jobParameters?: string
  notebookParams?: string
  idempotencyToken?: string
}

export interface DatabricksRunJobResponse extends ToolResponse {
  output: {
    runId: number
    numberInJob: number
  }
}

/** Get Run */
export interface DatabricksGetRunParams extends DatabricksBaseParams {
  runId: number
  includeHistory?: boolean
  includeResolvedValues?: boolean
}

export interface DatabricksGetRunResponse extends ToolResponse {
  output: {
    runId: number
    jobId: number
    runName: string
    runType: string
    attemptNumber: number
    state: {
      lifeCycleState: string
      resultState: string | null
      stateMessage: string
      userCancelledOrTimedout: boolean
    }
    startTime: number | null
    endTime: number | null
    setupDuration: number | null
    executionDuration: number | null
    cleanupDuration: number | null
    queueDuration: number | null
    runPageUrl: string
    creatorUserName: string
  }
}

/** List Runs */
export interface DatabricksListRunsParams extends DatabricksBaseParams {
  jobId?: number
  activeOnly?: boolean
  completedOnly?: boolean
  limit?: number
  offset?: number
  runType?: string
  startTimeFrom?: number
  startTimeTo?: number
}

export interface DatabricksListRunsResponse extends ToolResponse {
  output: {
    runs: Array<{
      runId: number
      jobId: number
      runName: string
      runType: string
      state: {
        lifeCycleState: string
        resultState: string | null
        stateMessage: string
        userCancelledOrTimedout: boolean
      }
      startTime: number | null
      endTime: number | null
    }>
    hasMore: boolean
    nextPageToken: string | null
  }
}

/** Cancel Run */
export interface DatabricksCancelRunParams extends DatabricksBaseParams {
  runId: number
}

export interface DatabricksCancelRunResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/** Get Run Output */
export interface DatabricksGetRunOutputParams extends DatabricksBaseParams {
  runId: number
}

export interface DatabricksGetRunOutputResponse extends ToolResponse {
  output: {
    notebookOutput: {
      result: string | null
      truncated: boolean
    } | null
    error: string | null
    errorTrace: string | null
    logs: string | null
    logsTruncated: boolean
  }
}

/** List Clusters */
export interface DatabricksListClustersResponse extends ToolResponse {
  output: {
    clusters: Array<{
      clusterId: string
      clusterName: string
      state: string
      stateMessage: string
      creatorUserName: string
      sparkVersion: string
      nodeTypeId: string
      driverNodeTypeId: string
      numWorkers: number | null
      autoscale: { minWorkers: number; maxWorkers: number } | null
      clusterSource: string
      autoterminationMinutes: number
      startTime: number | null
    }>
  }
}

/** Union type for all Databricks responses */
export type DatabricksResponse =
  | DatabricksExecuteSqlResponse
  | DatabricksListJobsResponse
  | DatabricksRunJobResponse
  | DatabricksGetRunResponse
  | DatabricksListRunsResponse
  | DatabricksCancelRunResponse
  | DatabricksGetRunOutputResponse
  | DatabricksListClustersResponse
