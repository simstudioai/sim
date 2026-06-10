import type {
  DatabricksExecuteSqlResponse,
  DatabricksGetStatementParams,
} from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const getStatementTool: ToolConfig<
  DatabricksGetStatementParams,
  DatabricksExecuteSqlResponse
> = {
  id: 'databricks_get_statement',
  name: 'Databricks Get Statement',
  description:
    'Poll a SQL statement by its ID to retrieve status and results. Use this after Execute SQL when a query runs longer than the wait timeout.',
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
    statementId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the statement to fetch (returned by Execute SQL)',
    },
  },

  request: {
    url: (params) => {
      const host = params.host
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')
      return `https://${host}/api/2.0/sql/statements/${params.statementId.trim()}`
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
      throw new Error(data.message || data.error?.message || 'Failed to get statement')
    }

    const status = data.status?.state ?? 'UNKNOWN'
    if (status === 'FAILED') {
      throw new Error(
        data.status?.error?.message ||
          `SQL statement execution failed: ${data.status?.error?.error_code ?? 'UNKNOWN'}`
      )
    }

    const columns =
      data.manifest?.schema?.columns?.map(
        (col: { name: string; position: number; type_name: string }) => ({
          name: col.name ?? '',
          position: col.position ?? 0,
          typeName: col.type_name ?? '',
        })
      ) ?? null

    return {
      success: true,
      output: {
        statementId: data.statement_id ?? '',
        status,
        columns,
        data: data.result?.data_array ?? null,
        totalRows: data.manifest?.total_row_count ?? null,
        truncated: data.manifest?.truncated ?? false,
      },
    }
  },

  outputs: {
    statementId: {
      type: 'string',
      description: 'Unique identifier for the statement',
    },
    status: {
      type: 'string',
      description: 'Execution status (SUCCEEDED, PENDING, RUNNING, FAILED, CANCELED, CLOSED)',
    },
    columns: {
      type: 'array',
      description: 'Column schema of the result set',
      optional: true,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Column name' },
          position: { type: 'number', description: 'Column position (0-based)' },
          typeName: {
            type: 'string',
            description:
              'Column type (STRING, INT, LONG, DOUBLE, BOOLEAN, TIMESTAMP, DATE, DECIMAL, etc.)',
          },
        },
      },
    },
    data: {
      type: 'array',
      description:
        'Result rows as a 2D array of strings where each inner array is a row of column values',
      optional: true,
      items: {
        type: 'array',
        description: 'A single row of column values as strings',
      },
    },
    totalRows: {
      type: 'number',
      description: 'Total number of rows in the result',
      optional: true,
    },
    truncated: {
      type: 'boolean',
      description: 'Whether the result set was truncated due to row_limit or byte_limit',
    },
  },
}
