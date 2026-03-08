import type {
  DatabricksExecuteSqlParams,
  DatabricksExecuteSqlResponse,
} from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const executeSqlTool: ToolConfig<DatabricksExecuteSqlParams, DatabricksExecuteSqlResponse> =
  {
    id: 'databricks_execute_sql',
    name: 'Databricks Execute SQL',
    description:
      'Execute a SQL statement against a Databricks SQL warehouse and return results inline. Supports parameterized queries and Unity Catalog.',
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
      warehouseId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the SQL warehouse to execute against',
      },
      statement: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The SQL statement to execute (max 16 MiB)',
      },
      catalog: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Unity Catalog name (equivalent to USE CATALOG)',
      },
      schema: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Schema name (equivalent to USE SCHEMA)',
      },
      rowLimit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of rows to return',
      },
      waitTimeout: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'How long to wait for results (e.g., "50s"). Range: "0s" or "5s" to "50s". Default: "50s"',
      },
    },

    request: {
      url: (params) => {
        const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
        return `https://${host}/api/2.0/sql/statements/`
      },
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const body: Record<string, unknown> = {
          warehouse_id: params.warehouseId,
          statement: params.statement,
          format: 'JSON_ARRAY',
          disposition: 'INLINE',
          wait_timeout: params.waitTimeout || '50s',
        }
        if (params.catalog) body.catalog = params.catalog
        if (params.schema) body.schema = params.schema
        if (params.rowLimit) body.row_limit = params.rowLimit
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error?.message || 'Failed to execute SQL statement')
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
        description: 'Unique identifier for the executed statement',
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
