import type { ClickHouseCountResponse, ClickHouseCountRowsParams } from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const countRowsTool: ToolConfig<ClickHouseCountRowsParams, ClickHouseCountResponse> = {
  id: 'clickhouse_count_rows',
  name: 'ClickHouse Count Rows',
  description: 'Count rows in a ClickHouse table, optionally filtered',
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
      description: 'Table name to count rows in',
    },
    where: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional WHERE clause condition without the WHERE keyword',
    },
  },

  request: {
    url: '/api/tools/clickhouse/count-rows',
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
      where: params.where,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'ClickHouse count rows failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Row count retrieved',
        count: data.count ?? 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    count: { type: 'number', description: 'Number of rows' },
  },
}
