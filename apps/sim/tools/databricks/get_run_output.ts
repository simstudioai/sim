import type {
  DatabricksGetRunOutputParams,
  DatabricksGetRunOutputResponse,
} from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const getRunOutputTool: ToolConfig<
  DatabricksGetRunOutputParams,
  DatabricksGetRunOutputResponse
> = {
  id: 'databricks_get_run_output',
  name: 'Databricks Get Run Output',
  description:
    'Get the output of a completed Databricks job run, including notebook results, error messages, and logs. For multi-task jobs, use the task run ID (not the parent run ID).',
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
      description: 'The run ID to get output for. For multi-task jobs, use the task run ID',
    },
  },

  request: {
    url: (params) => {
      const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      return `https://${host}/api/2.1/jobs/runs/get-output?run_id=${params.runId}`
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
      throw new Error(data.message || data.error?.message || 'Failed to get run output')
    }

    return {
      success: true,
      output: {
        notebookOutput: data.notebook_output
          ? {
              result: data.notebook_output.result ?? null,
              truncated: data.notebook_output.truncated ?? false,
            }
          : null,
        error: data.error ?? null,
        errorTrace: data.error_trace ?? null,
        logs: data.logs ?? null,
        logsTruncated: data.logs_truncated ?? false,
      },
    }
  },

  outputs: {
    notebookOutput: {
      type: 'object',
      description: 'Notebook task output (from dbutils.notebook.exit())',
      optional: true,
      properties: {
        result: {
          type: 'string',
          description: 'Value passed to dbutils.notebook.exit() (max 5 MB)',
          optional: true,
        },
        truncated: {
          type: 'boolean',
          description: 'Whether the result was truncated',
        },
      },
    },
    error: {
      type: 'string',
      description: 'Error message if the run failed or output is unavailable',
      optional: true,
    },
    errorTrace: {
      type: 'string',
      description: 'Error stack trace if available',
      optional: true,
    },
    logs: {
      type: 'string',
      description: 'Log output (last 5 MB) from spark_jar, spark_python, or python_wheel tasks',
      optional: true,
    },
    logsTruncated: {
      type: 'boolean',
      description: 'Whether the log output was truncated',
    },
  },
}
