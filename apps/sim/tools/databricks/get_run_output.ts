import type {
  DatabricksGetRunOutputParams,
  DatabricksGetRunOutputResponse,
} from '@/tools/databricks/types'
import { databricksUrl } from '@/tools/databricks/utils'
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
    url: (params) =>
      databricksUrl(
        params.host,
        `/api/2.2/jobs/runs/get-output?run_id=${encodeURIComponent(String(params.runId))}`
      ),
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
        sqlOutput: data.sql_output ?? null,
        dbtOutput: data.dbt_output ?? null,
        runJobOutput: data.run_job_output ?? null,
        info: data.info ?? null,
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
    info: { type: 'string', nullable: true, description: 'Additional output information' },
    runJobOutput: {
      type: 'object',
      nullable: true,
      description: 'Run Job task result',
      properties: { run_id: { type: 'number', description: 'Child run identifier' } },
    },
    dbtOutput: {
      type: 'object',
      nullable: true,
      description: 'dbt artifact download information',
      properties: {
        artifacts_link: { type: 'string', description: 'Temporary artifact URL' },
        artifacts_headers: {
          type: 'object',
          description: 'Headers required to fetch the artifact',
        },
      },
    },
    sqlOutput: {
      type: 'object',
      nullable: true,
      description: 'SQL query, alert, or dashboard task results',
      properties: {
        query_output: {
          type: 'object',
          properties: {
            query_text: { type: 'string' },
            warehouse_id: { type: 'string' },
            output_link: { type: 'string' },
          },
        },
        alert_output: {
          type: 'object',
          properties: {
            query_text: { type: 'string' },
            alert_state: { type: 'string' },
            output_link: { type: 'string' },
          },
        },
        dashboard_output: {
          type: 'object',
          properties: {
            warehouse_id: { type: 'string' },
            widgets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  widget_id: { type: 'string' },
                  widget_title: { type: 'string' },
                  status: { type: 'string' },
                  output_link: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    notebookOutput: {
      type: 'object',
      description: 'Notebook task output (from dbutils.notebook.exit())',
      nullable: true,
      properties: {
        result: {
          type: 'string',
          description: 'Value passed to dbutils.notebook.exit() (max 5 MB)',
          nullable: true,
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
      nullable: true,
    },
    errorTrace: {
      type: 'string',
      description: 'Error stack trace if available',
      nullable: true,
    },
    logs: {
      type: 'string',
      description: 'Log output (last 5 MB) from spark_jar, spark_python, or python_wheel tasks',
      nullable: true,
    },
    logsTruncated: {
      type: 'boolean',
      description: 'Whether the log output was truncated',
    },
  },
}
