import type {
  ClickHouseDropPartitionParams,
  ClickHouseMessageResponse,
} from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const dropPartitionTool: ToolConfig<
  ClickHouseDropPartitionParams,
  ClickHouseMessageResponse
> = {
  id: 'clickhouse_drop_partition',
  name: 'ClickHouse Drop Partition',
  description: 'Drop a partition from a ClickHouse table',
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
      description: 'Table name',
    },
    partition: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Partition expression, e.g. '2024-01' or 202401",
    },
  },

  request: {
    url: '/api/tools/clickhouse/drop-partition',
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
      partition: params.partition,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'ClickHouse drop partition failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Partition dropped',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
