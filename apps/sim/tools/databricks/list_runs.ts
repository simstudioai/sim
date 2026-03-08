import type { DatabricksListRunsParams, DatabricksListRunsResponse } from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const listRunsTool: ToolConfig<DatabricksListRunsParams, DatabricksListRunsResponse> = {
  id: 'databricks_list_runs',
  name: 'Databricks List Runs',
  description:
    'List job runs in a Databricks workspace with optional filtering by job, status, and time range.',
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
    jobId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter runs by job ID. Omit to list runs across all jobs',
    },
    activeOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include active runs (PENDING, RUNNING, or TERMINATING)',
    },
    completedOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include completed runs',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of runs to return (range 1-24, default 20)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination',
    },
    runType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by run type (JOB_RUN, WORKFLOW_RUN, SUBMIT_RUN)',
    },
    startTimeFrom: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter runs started at or after this timestamp (epoch ms)',
    },
    startTimeTo: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter runs started at or before this timestamp (epoch ms)',
    },
  },

  request: {
    url: (params) => {
      const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const url = new URL(`https://${host}/api/2.1/jobs/runs/list`)
      if (params.jobId) url.searchParams.set('job_id', String(params.jobId))
      if (params.activeOnly) url.searchParams.set('active_only', 'true')
      if (params.completedOnly) url.searchParams.set('completed_only', 'true')
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))
      if (params.runType) url.searchParams.set('run_type', params.runType)
      if (params.startTimeFrom)
        url.searchParams.set('start_time_from', String(params.startTimeFrom))
      if (params.startTimeTo) url.searchParams.set('start_time_to', String(params.startTimeTo))
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
      throw new Error(data.message || data.error?.message || 'Failed to list runs')
    }

    const runs = (data.runs ?? []).map(
      (run: {
        run_id?: number
        job_id?: number
        run_name?: string
        run_type?: string
        state?: {
          life_cycle_state?: string
          result_state?: string
          state_message?: string
          user_cancelled_or_timedout?: boolean
        }
        start_time?: number
        end_time?: number
      }) => ({
        runId: run.run_id ?? 0,
        jobId: run.job_id ?? 0,
        runName: run.run_name ?? '',
        runType: run.run_type ?? '',
        state: {
          lifeCycleState: run.state?.life_cycle_state ?? 'UNKNOWN',
          resultState: run.state?.result_state ?? null,
          stateMessage: run.state?.state_message ?? '',
          userCancelledOrTimedout: run.state?.user_cancelled_or_timedout ?? false,
        },
        startTime: run.start_time ?? null,
        endTime: run.end_time ?? null,
      })
    )

    return {
      success: true,
      output: {
        runs,
        hasMore: data.has_more ?? false,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    runs: {
      type: 'array',
      description: 'List of job runs',
      items: {
        type: 'object',
        properties: {
          runId: { type: 'number', description: 'Unique run identifier' },
          jobId: { type: 'number', description: 'Job this run belongs to' },
          runName: { type: 'string', description: 'Run name' },
          runType: { type: 'string', description: 'Run type (JOB_RUN, WORKFLOW_RUN, SUBMIT_RUN)' },
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
              stateMessage: { type: 'string', description: 'Descriptive state message' },
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
          endTime: { type: 'number', description: 'Run end timestamp (epoch ms)', optional: true },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more runs are available for pagination',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
