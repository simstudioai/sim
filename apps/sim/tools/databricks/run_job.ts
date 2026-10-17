import type { DatabricksRunJobParams, DatabricksRunJobResponse } from '@/tools/databricks/types'
import {
  databricksUrl,
  optionalDatabricksString,
  parseDatabricksJson,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const runJobTool: ToolConfig<DatabricksRunJobParams, DatabricksRunJobResponse> = {
  id: 'databricks_run_job',
  name: 'Databricks Run Job',
  description:
    'Trigger an existing Databricks job to run immediately with optional job-level or notebook parameters.',
  version: '1.0.0',

  params: {
    only: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task keys to run; omit to run every task',
    },
    queue: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run queue settings as {enabled: true} or {enabled: false}',
    },
    performanceTarget: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Serverless performance: STANDARD or PERFORMANCE_OPTIMIZED',
    },
    pipelineParams: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pipeline full_refresh and selective table or flow settings',
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
      description: 'The ID of the job to trigger',
    },
    jobParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job-level parameter overrides as a JSON object (e.g., {"key": "value"})',
    },
    notebookParams: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notebook task parameters as a JSON object (e.g., {"param1": "value1"})',
    },
    idempotencyToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idempotency token to prevent duplicate runs (max 64 characters)',
    },
  },

  request: {
    url: (params) => databricksUrl(params.host, '/api/2.2/jobs/run-now'),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        job_id: params.jobId,
      }
      const jobParameters = parseDatabricksJson(params.jobParameters, 'jobParameters', 'object')
      if (jobParameters) body.job_parameters = jobParameters
      const notebookParams = parseDatabricksJson(params.notebookParams, 'notebookParams', 'object')
      if (notebookParams) body.notebook_params = notebookParams
      const idempotencyToken = optionalDatabricksString(params.idempotencyToken)
      if (idempotencyToken) body.idempotency_token = idempotencyToken
      const only = parseDatabricksJson(params.only, 'only', 'array')
      if (only) body.only = only
      const queue = parseDatabricksJson(params.queue, 'queue', 'object')
      if (queue) body.queue = queue
      const pipelineParams = parseDatabricksJson(params.pipelineParams, 'pipelineParams', 'object')
      if (pipelineParams) body.pipeline_params = pipelineParams
      const performanceTarget = optionalDatabricksString(params.performanceTarget)
      if (performanceTarget) body.performance_target = performanceTarget
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error?.message || 'Failed to trigger job run')
    }

    return {
      success: true,
      output: {
        runId: data.run_id ?? 0,
        numberInJob: data.number_in_job ?? 0,
      },
    }
  },

  outputs: {
    runId: {
      type: 'number',
      description: 'The globally unique ID of the triggered run',
    },
    numberInJob: {
      type: 'number',
      description: 'The sequence number of this run among all runs of the job',
    },
  },
}
