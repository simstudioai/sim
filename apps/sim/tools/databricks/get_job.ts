import type { DatabricksGetJobParams, DatabricksGetJobResponse } from '@/tools/databricks/types'
import { JOB_CLUSTERS_OUTPUT, JOB_TASK_OUTPUT } from '@/tools/databricks/types'
import { databricksUrl } from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const getJobTool: ToolConfig<DatabricksGetJobParams, DatabricksGetJobResponse> = {
  id: 'databricks_get_job',
  name: 'Databricks Get Job',
  description: 'Get the full definition and settings of a single Databricks job by its job ID.',
  version: '1.0.0',

  params: {
    includeTriggerState: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include current job trigger state',
    },
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
    jobId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The canonical identifier of the job to retrieve',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(databricksUrl(params.host, '/api/2.2/jobs/get'))
      url.searchParams.set('job_id', String(params.jobId))
      if (params.pageToken) url.searchParams.set('page_token', params.pageToken)
      if (params.includeTriggerState != null)
        url.searchParams.set('include_trigger_state', String(params.includeTriggerState))
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
      throw new Error(data.message || data.error?.message || 'Failed to get job')
    }

    const settings = data.settings ?? {}

    return {
      success: true,
      output: {
        jobId: data.job_id ?? 0,
        name: settings.name ?? '',
        creatorUserName: data.creator_user_name ?? '',
        runAsUserName: data.run_as_user_name ?? '',
        createdTime: data.created_time ?? 0,
        format: settings.format ?? '',
        maxConcurrentRuns: settings.max_concurrent_runs ?? 1,
        timeoutSeconds: settings.timeout_seconds ?? null,
        schedule: settings.schedule ?? null,
        tags: settings.tags ?? null,
        tasks: settings.tasks ?? [],
        description: settings.description ?? null,
        jobClusters: settings.job_clusters ?? [],
        parameters: settings.parameters ?? [],
        queue: settings.queue ?? null,
        triggerState: data.trigger_state ?? null,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    tasks: JOB_TASK_OUTPUT,
    jobClusters: JOB_CLUSTERS_OUTPUT,
    description: { type: 'string', nullable: true, description: 'Job description' },
    parameters: {
      type: 'array',
      description: 'Job parameter definitions',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, default: { type: 'string' } },
      },
    },
    queue: {
      type: 'object',
      nullable: true,
      description: 'Job queue settings',
      properties: { enabled: { type: 'boolean' } },
    },
    triggerState: {
      type: 'object',
      nullable: true,
      description: 'Current file-arrival, table-update, or periodic trigger state',
      properties: {
        file_arrival: { type: 'object', properties: { using_file_events: { type: 'boolean' } } },
        table: {
          type: 'object',
          properties: {
            using_scalable_monitoring: { type: 'boolean' },
            last_seen_table_states: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  table_name: { type: 'string' },
                  has_seen_updates: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      nullable: true,
      description: 'Token for the next page of tasks or job clusters',
    },

    jobId: { type: 'number', description: 'The job ID' },
    name: { type: 'string', description: 'Job name' },
    creatorUserName: { type: 'string', description: 'Email of the job creator' },
    runAsUserName: { type: 'string', description: 'User the job runs as' },
    createdTime: { type: 'number', description: 'Job creation timestamp (epoch ms)' },
    format: { type: 'string', description: 'Job format (SINGLE_TASK or MULTI_TASK)' },
    maxConcurrentRuns: { type: 'number', description: 'Maximum number of concurrent runs' },
    timeoutSeconds: {
      type: 'number',
      description: 'Job-level timeout in seconds (0 or null means no timeout)',
      nullable: true,
    },
    schedule: {
      type: 'object',
      description:
        'Cron schedule configuration (quartz_cron_expression, timezone_id, pause_status)',
      properties: {
        quartz_cron_expression: { type: 'string' },
        timezone_id: { type: 'string' },
        pause_status: { type: 'string' },
      },
      nullable: true,
    },
    tags: {
      type: 'object',
      description: 'Key-value tags applied to the job',
      nullable: true,
    },
  },
}
