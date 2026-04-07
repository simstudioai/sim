import type { ToolResponse } from '@/tools/types'

export interface DagsterBaseParams {
  host: string
  apiKey?: string
}

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

export interface DagsterGetRunParams extends DagsterBaseParams {
  runId: string
}

export interface DagsterGetRunResponse extends ToolResponse {
  output: {
    runId: string
    jobName: string | null
    status: string
    startTime: number | null
    endTime: number | null
    runConfigYaml: string | null
    tags: Array<{ key: string; value: string }> | null
  }
}

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

export interface DagsterListJobsResponse extends ToolResponse {
  output: {
    jobs: Array<{
      name: string
      repositoryName: string
    }>
  }
}

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

export interface DagsterGetRunLogsParams extends DagsterBaseParams {
  runId: string
  afterCursor?: string
  limit?: number
}

export interface DagsterGetRunLogsResponse extends ToolResponse {
  output: {
    events: Array<{
      type: string
      message: string
      timestamp: string
      level: string
      stepKey: string | null
      eventType: string | null
    }>
    cursor: string | null
    hasMore: boolean
  }
}

export interface DagsterReexecuteRunParams extends DagsterBaseParams {
  parentRunId: string
  strategy: string
}

export interface DagsterReexecuteRunResponse extends ToolResponse {
  output: {
    runId: string
  }
}

export interface DagsterDeleteRunParams extends DagsterBaseParams {
  runId: string
}

export interface DagsterDeleteRunResponse extends ToolResponse {
  output: {
    runId: string
  }
}

export interface DagsterListSchedulesParams extends DagsterBaseParams {
  repositoryLocationName: string
  repositoryName: string
  scheduleStatus?: string
}

export interface DagsterListSchedulesResponse extends ToolResponse {
  output: {
    schedules: Array<{
      name: string
      cronSchedule: string | null
      jobName: string | null
      status: string
      id: string | null
      description: string | null
      executionTimezone: string | null
    }>
  }
}

export interface DagsterStartScheduleParams extends DagsterBaseParams {
  repositoryLocationName: string
  repositoryName: string
  scheduleName: string
}

export interface DagsterScheduleMutationResponse extends ToolResponse {
  output: {
    id: string
    status: string
  }
}

export interface DagsterStopScheduleParams extends DagsterBaseParams {
  instigationStateId: string
}

export interface DagsterListSensorsParams extends DagsterBaseParams {
  repositoryLocationName: string
  repositoryName: string
  sensorStatus?: string
}

export interface DagsterListSensorsResponse extends ToolResponse {
  output: {
    sensors: Array<{
      name: string
      sensorType: string | null
      status: string
      id: string | null
      description: string | null
    }>
  }
}

export interface DagsterStartSensorParams extends DagsterBaseParams {
  repositoryLocationName: string
  repositoryName: string
  sensorName: string
}

export interface DagsterSensorMutationResponse extends ToolResponse {
  output: {
    id: string
    status: string
  }
}

export interface DagsterStopSensorParams extends DagsterBaseParams {
  instigationStateId: string
}

export type DagsterResponse =
  | DagsterLaunchRunResponse
  | DagsterGetRunResponse
  | DagsterListRunsResponse
  | DagsterListJobsResponse
  | DagsterTerminateRunResponse
  | DagsterGetRunLogsResponse
  | DagsterReexecuteRunResponse
  | DagsterDeleteRunResponse
  | DagsterListSchedulesResponse
  | DagsterScheduleMutationResponse
  | DagsterListSensorsResponse
  | DagsterSensorMutationResponse
