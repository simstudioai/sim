import type {
  DatabricksCancelRunParams,
  DatabricksCancelRunResponse,
} from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const cancelRunTool: ToolConfig<DatabricksCancelRunParams, DatabricksCancelRunResponse> = {
  id: 'databricks_cancel_run',
  name: 'Databricks Cancel Run',
  description:
    'Cancel a running or pending Databricks job run. Cancellation is asynchronous; poll the run status to confirm termination.',
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
      description: 'The canonical identifier of the run to cancel',
    },
  },

  request: {
    url: (params) => {
      const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      return `https://${host}/api/2.1/jobs/runs/cancel`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      run_id: params.runId,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.message || data.error?.message || 'Failed to cancel run')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the cancel request was accepted',
    },
  },
}
