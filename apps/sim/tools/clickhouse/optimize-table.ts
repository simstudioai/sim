import type {
  ClickHouseMessageResponse,
  ClickHouseOptimizeTableParams,
} from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const optimizeTableTool: ToolConfig<
  ClickHouseOptimizeTableParams,
  ClickHouseMessageResponse
> = {
  id: 'clickhouse_optimize_table',
  name: 'ClickHouse Optimize Table',
  description: 'Trigger a merge of table parts via OPTIMIZE TABLE',
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
      description: 'Table to optimize',
    },
    final: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Force a merge to a single part using FINAL',
    },
  },

  request: {
    url: '/api/tools/clickhouse/optimize-table',
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
      final: params.final,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'ClickHouse optimize table failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Optimize submitted',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
