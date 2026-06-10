import type { DatabricksGetJobParams, DatabricksGetJobResponse } from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const getJobTool: ToolConfig<DatabricksGetJobParams, DatabricksGetJobResponse> = {
  id: 'databricks_get_job',
  name: 'Databricks Get Job',
  description: 'Get the full definition and settings of a single Databricks job by its job ID.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The canonical identifier of the job to retrieve',
    },
  },

  request: {
    url: (params) => {
      const host = params.host
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')
      const url = new URL(`https://${host}/api/2.1/jobs/get`)
      url.searchParams.set('job_id', String(params.jobId))
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
      },
    }
  },

  outputs: {
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
      optional: true,
    },
    schedule: {
      type: 'object',
      description:
        'Cron schedule configuration (quartz_cron_expression, timezone_id, pause_status)',
      optional: true,
    },
    tags: {
      type: 'object',
      description: 'Key-value tags applied to the job',
      optional: true,
    },
    tasks: {
      type: 'array',
      description: 'Task definitions for the job (empty for single-task jobs)',
      items: { type: 'object' },
    },
  },
}
