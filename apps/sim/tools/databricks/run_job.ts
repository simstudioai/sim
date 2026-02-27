import type { DatabricksRunJobParams, DatabricksRunJobResponse } from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const runJobTool: ToolConfig<DatabricksRunJobParams, DatabricksRunJobResponse> = {
  id: 'databricks_run_job',
  name: 'Databricks Run Job',
  description:
    'Trigger an existing Databricks job to run immediately with optional job-level or notebook parameters.',
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
      description: 'The ID of the job to trigger',
    },
    jobParameters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job-level parameter overrides as a JSON object (e.g., {"key": "value"})',
    },
    notebookParams: {
      type: 'string',
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
    url: (params) => {
      const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      return `https://${host}/api/2.1/jobs/run-now`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        job_id: params.jobId,
      }
      if (params.jobParameters) {
        try {
          body.job_parameters = JSON.parse(params.jobParameters)
        } catch (error) {
          throw new Error(
            `Invalid JSON in jobParameters: ${error instanceof Error ? error.message : 'unknown error'}`
          )
        }
      }
      if (params.notebookParams) {
        try {
          body.notebook_params = JSON.parse(params.notebookParams)
        } catch (error) {
          throw new Error(
            `Invalid JSON in notebookParams: ${error instanceof Error ? error.message : 'unknown error'}`
          )
        }
      }
      if (params.idempotencyToken) body.idempotency_token = params.idempotencyToken
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
