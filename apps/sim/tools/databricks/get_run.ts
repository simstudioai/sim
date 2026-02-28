import type { DatabricksGetRunParams, DatabricksGetRunResponse } from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const getRunTool: ToolConfig<DatabricksGetRunParams, DatabricksGetRunResponse> = {
  id: 'databricks_get_run',
  name: 'Databricks Get Run',
  description: 'Get the status, timing, and details of a Databricks job run by its run ID.',
  version: '1.0.0',

  params: {
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
      const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const url = new URL(`https://${host}/api/2.1/jobs/runs/get`)
      url.searchParams.set('run_id', String(params.runId))
      if (params.includeHistory) url.searchParams.set('include_history', 'true')
      if (params.includeResolvedValues) url.searchParams.set('include_resolved_values', 'true')
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
          optional: true,
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
      optional: true,
    },
    endTime: {
      type: 'number',
      description: 'Run end timestamp (epoch ms, 0 if still running)',
      optional: true,
    },
    setupDuration: {
      type: 'number',
      description: 'Cluster setup duration (ms)',
      optional: true,
    },
    executionDuration: {
      type: 'number',
      description: 'Execution duration (ms)',
      optional: true,
    },
    cleanupDuration: {
      type: 'number',
      description: 'Cleanup duration (ms)',
      optional: true,
    },
    queueDuration: {
      type: 'number',
      description: 'Time spent in queue before execution (ms)',
      optional: true,
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
