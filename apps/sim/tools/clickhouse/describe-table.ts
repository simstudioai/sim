import type {
  ClickHouseDescribeTableParams,
  ClickHouseRowsResponse,
} from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const describeTableTool: ToolConfig<ClickHouseDescribeTableParams, ClickHouseRowsResponse> =
  {
    id: 'clickhouse_describe_table',
    name: 'ClickHouse Describe Table',
    description: 'Describe the columns of a ClickHouse table',
    version: '1.0',

    params: {
      host: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'ClickHouse server hostname (e.g., your-instance.clickhouse.cloud)',
      },
      port: {
        type: 'number',
        required: true,
        visibility: 'user-only',
        description: 'ClickHouse HTTP interface port (8443 for HTTPS, 8123 for HTTP)',
      },
      database: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Database name to connect to',
      },
      username: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'ClickHouse username',
      },
      password: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'ClickHouse password',
      },
      secure: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Use a secure HTTPS connection (default: true)',
      },
      table: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Table name to describe',
      },
    },

    request: {
      url: '/api/tools/clickhouse/describe-table',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        host: params.host,
        port: Number(params.port),
        database: params.database,
        username: params.username,
        password: params.password,
        secure: params.secure,
        table: params.table,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'ClickHouse describe table failed')
      }

      return {
        success: true,
        output: {
          message: data.message || 'Table described',
          rows: data.rows || [],
          rowCount: data.rowCount || 0,
        },
        error: undefined,
      }
    },

    outputs: {
      message: { type: 'string', description: 'Operation status message' },
      rows: { type: 'array', description: 'Array of rows returned from the query' },
      rowCount: { type: 'number', description: 'Number of rows returned' },
    },
  }
