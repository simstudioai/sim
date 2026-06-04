import {
  CLICKHOUSE_TABLE_OUTPUT_PROPERTIES,
  type ClickHouseIntrospectParams,
  type ClickHouseIntrospectResponse,
} from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<ClickHouseIntrospectParams, ClickHouseIntrospectResponse> =
  {
    id: 'clickhouse_introspect',
    name: 'ClickHouse Introspect',
    description:
      'Introspect a ClickHouse database to retrieve table structures, columns, and engines',
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
        description: 'Database name to introspect',
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
    },

    request: {
      url: '/api/tools/clickhouse/introspect',
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
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'ClickHouse introspection failed')
      }

      return {
        success: true,
        output: {
          message: data.message || 'Schema introspection completed successfully',
          tables: data.tables || [],
        },
        error: undefined,
      }
    },

    outputs: {
      message: { type: 'string', description: 'Operation status message' },
      tables: {
        type: 'array',
        description: 'Array of table schemas with columns and engines',
        items: {
          type: 'object',
          properties: CLICKHOUSE_TABLE_OUTPUT_PROPERTIES,
        },
      },
    },
  }
