import type {
  DatabricksExecuteSqlParams,
  DatabricksExecuteSqlResponse,
} from '@/tools/databricks/types'
import { GENIE_QUERY_RESULT_OUTPUTS } from '@/tools/databricks/types'
import { databricksUrl, mapStatementResult, parseDatabricksJson } from '@/tools/databricks/utils'
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
      sqlParameters: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Named parameters as [{name, value, type}]; null or omitted value represents SQL NULL',
      },
      byteLimit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum result size in bytes; truncation is reported in the output',
      },
      onWaitTimeout: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'CONTINUE (default) or CANCEL execution when the wait timeout expires',
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
      url: (params) => databricksUrl(params.host, '/api/2.0/sql/statements/'),
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
        if (params.rowLimit != null) body.row_limit = params.rowLimit
        if (params.byteLimit != null) body.byte_limit = params.byteLimit
        if (params.onWaitTimeout) body.on_wait_timeout = params.onWaitTimeout
        const parameters = parseDatabricksJson(params.sqlParameters, 'sqlParameters', 'array')
        if (parameters) body.parameters = parameters
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error?.message || 'Failed to execute SQL statement')
      }

      return { success: true, output: mapStatementResult(data) }
    },

    outputs: GENIE_QUERY_RESULT_OUTPUTS,
  }
