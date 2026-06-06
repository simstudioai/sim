import type {
  ClickHouseDropDatabaseParams,
  ClickHouseMessageResponse,
} from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const dropDatabaseTool: ToolConfig<ClickHouseDropDatabaseParams, ClickHouseMessageResponse> =
  {
    id: 'clickhouse_drop_database',
    name: 'ClickHouse Drop Database',
    description: 'Drop a database from a ClickHouse server',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the database to drop',
      },
    },

    request: {
      url: '/api/tools/clickhouse/drop-database',
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
        name: params.name,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'ClickHouse drop database failed')
      }

      return {
        success: true,
        output: {
          message: data.message || 'Database dropped',
        },
        error: undefined,
      }
    },

    outputs: {
      message: { type: 'string', description: 'Operation status message' },
    },
  }
