import type { DatabricksGetRunParams, DatabricksGetRunResponse } from '@/tools/databricks/types'
import {
  JOB_CLUSTERS_OUTPUT,
  JOB_TASK_OUTPUT,
  RUN_STATUS_OUTPUT,
  RUN_STATUS_OUTPUT_PROPERTIES,
} from '@/tools/databricks/types'
import { databricksUrl } from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const getRunTool: ToolConfig<DatabricksGetRunParams, DatabricksGetRunResponse> = {
  id: 'databricks_get_run',
  name: 'Databricks Get Run',
  description: 'Get the status, timing, and details of a Databricks job run by its run ID.',
  version: '1.0.0',

  params: {
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for the next page of tasks and job clusters',
    },
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks workspace host (e.g., dbc-abc123.cloud.databricks.com)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks Personal Access Token',
    },
    runId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The canonical identifier of the run',
    },
    includeHistory: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include repair history in the response',
    },
    includeResolvedValues: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include resolved parameter values in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(databricksUrl(params.host, '/api/2.2/jobs/runs/get'))
      url.searchParams.set('run_id', String(params.runId))
      if (params.includeHistory) url.searchParams.set('include_history', 'true')
      if (params.includeResolvedValues) url.searchParams.set('include_resolved_values', 'true')
      if (params.pageToken) url.searchParams.set('page_token', params.pageToken)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error?.message || 'Failed to get run details')
    }

    return {
      success: true,
      output: {
        tasks: data.tasks ?? [],
        repairHistory: data.repair_history ?? [],
        jobParameters: data.job_parameters ?? [],
        jobClusters: data.job_clusters ?? [],
        runStatus: data.status ?? null,
        runDuration: data.run_duration ?? null,
        nextPageToken: data.next_page_token ?? null,
        runId: data.run_id ?? 0,
        jobId: data.job_id ?? 0,
        runName: data.run_name ?? '',
        runType: data.run_type ?? '',
        attemptNumber: data.attempt_number ?? 0,
        state: {
          lifeCycleState: data.state?.life_cycle_state ?? 'UNKNOWN',
          resultState: data.state?.result_state ?? null,
          stateMessage: data.state?.state_message ?? '',
          userCancelledOrTimedout: data.state?.user_cancelled_or_timedout ?? false,
        },
        startTime: data.start_time ?? null,
        endTime: data.end_time ?? null,
        setupDuration: data.setup_duration ?? null,
        executionDuration: data.execution_duration ?? null,
        cleanupDuration: data.cleanup_duration ?? null,
        queueDuration: data.queue_duration ?? null,
        runPageUrl: data.run_page_url ?? '',
        creatorUserName: data.creator_user_name ?? '',
      },
    }
  },

  outputs: {
    tasks: JOB_TASK_OUTPUT,
    jobClusters: JOB_CLUSTERS_OUTPUT,
    runStatus: RUN_STATUS_OUTPUT,
    repairHistory: {
      type: 'array',
      description: 'Prior repairs; pass the latest id to Repair Run',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', optional: true },
          type: { type: 'string' },
          start_time: { type: 'number' },
          end_time: { type: 'number' },
          task_run_ids: { type: 'array', items: { type: 'number' } },
          status: {
            type: 'object',
            optional: true,
            description: 'Run lifecycle and termination or queue details',
            properties: RUN_STATUS_OUTPUT_PROPERTIES,
          },
        },
      },
    },
    jobParameters: {
      type: 'array',
      description: 'Resolved job parameter values',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'string' } },
      },
    },
    runDuration: {
      type: 'number',
      nullable: true,
      description: 'Run duration including repairs in milliseconds',
    },
    nextPageToken: {
      type: 'string',
      nullable: true,
      description: 'Token for the next page of tasks or job clusters',
    },

    runId: {
      type: 'number',
      description: 'The run ID',
    },
    jobId: {
      type: 'number',
      description: 'The job ID this run belongs to',
    },
    runName: {
      type: 'string',
      description: 'Name of the run',
    },
    runType: {
      type: 'string',
      description: 'Type of run (JOB_RUN, WORKFLOW_RUN, SUBMIT_RUN)',
    },
    attemptNumber: {
      type: 'number',
      description: 'Retry attempt number (0 for initial attempt)',
    },
    state: {
      type: 'object',
      description: 'Run state information',
      properties: {
        lifeCycleState: {
          type: 'string',
          description:
            'Lifecycle state (QUEUED, PENDING, RUNNING, TERMINATING, TERMINATED, SKIPPED, INTERNAL_ERROR, BLOCKED, WAITING_FOR_RETRY)',
        },
        resultState: {
          type: 'string',
          description:
            'Result state (SUCCESS, FAILED, TIMEDOUT, CANCELED, SUCCESS_WITH_FAILURES, UPSTREAM_FAILED, UPSTREAM_CANCELED, EXCLUDED)',
          nullable: true,
        },
        stateMessage: {
          type: 'string',
          description: 'Descriptive message for the current state',
        },
        userCancelledOrTimedout: {
          type: 'boolean',
          description: 'Whether the run was cancelled by user or timed out',
        },
      },
    },
    startTime: {
      type: 'number',
      description: 'Run start timestamp (epoch ms)',
      nullable: true,
    },
    endTime: {
      type: 'number',
      description: 'Run end timestamp (epoch ms, 0 if still running)',
      nullable: true,
    },
    setupDuration: {
      type: 'number',
      description: 'Cluster setup duration (ms)',
      nullable: true,
    },
    executionDuration: {
      type: 'number',
      description: 'Execution duration (ms)',
      nullable: true,
    },
    cleanupDuration: {
      type: 'number',
      description: 'Cleanup duration (ms)',
      nullable: true,
    },
    queueDuration: {
      type: 'number',
      description: 'Time spent in queue before execution (ms)',
      nullable: true,
    },
    runPageUrl: {
      type: 'string',
      description: 'URL to the run detail page in Databricks UI',
    },
    creatorUserName: {
      type: 'string',
      description: 'Email of the user who triggered the run',
    },
  },
}
