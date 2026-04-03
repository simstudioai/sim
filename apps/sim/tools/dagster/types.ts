import type { ToolResponse } from '@/tools/types'

/** Base parameters shared by all Dagster tools */
export interface DagsterBaseParams {
  /** Dagster host URL (e.g., https://myorg.dagster.cloud/prod or http://localhost:3001) */
  host: string
  /** Dagster+ API token */
  apiKey: string
}

/** Launch Run */
export interface DagsterLaunchRunParams extends DagsterBaseParams {
  repositoryLocationName: string
  repositoryName: string
  jobName: string
  runConfigJson?: string
  tags?: string
}

export interface DagsterLaunchRunResponse extends ToolResponse {
  output: {
    runId: string
  }
}

/** Get Run */
export interface DagsterGetRunParams extends DagsterBaseParams {
  runId: string
}

export interface DagsterGetRunResponse extends ToolResponse {
  output: {
    runId: string
    jobName: string
    status: string
    startTime: number | null
    endTime: number | null
    runConfigYaml: string | null
    tags: Array<{ key: string; value: string }> | null
  }
}

/** List Runs */
export interface DagsterListRunsParams extends DagsterBaseParams {
  jobName?: string
  statuses?: string
  limit?: number
}

export interface DagsterListRunsResponse extends ToolResponse {
  output: {
    runs: Array<{
      runId: string
      jobName: string | null
      status: string
      tags: Array<{ key: string; value: string }> | null
      startTime: number | null
      endTime: number | null
    }>
  }
}

/** List Jobs */
export interface DagsterListJobsResponse extends ToolResponse {
  output: {
    jobs: Array<{
      name: string
      repositoryName: string
    }>
  }
}

/** Terminate Run */
export interface DagsterTerminateRunParams extends DagsterBaseParams {
  runId: string
}

export interface DagsterTerminateRunResponse extends ToolResponse {
  output: {
    success: boolean
    runId: string
    message: string | null
  }
}

/** Union type for all Dagster responses */
export type DagsterResponse =
  | DagsterLaunchRunResponse
  | DagsterGetRunResponse
  | DagsterListRunsResponse
  | DagsterListJobsResponse
  | DagsterTerminateRunResponse
