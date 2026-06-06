import type {
  ClickHouseCreateTableParams,
  ClickHouseMessageResponse,
} from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const createTableTool: ToolConfig<ClickHouseCreateTableParams, ClickHouseMessageResponse> = {
  id: 'clickhouse_create_table',
  name: 'ClickHouse Create Table',
  description: 'Create a new MergeTree-family table in ClickHouse',
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
      description: 'Name of the table to create',
    },
    columns: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of column definitions, each an object with name and type, e.g. [{"name":"id","type":"UInt64"},{"name":"ts","type":"DateTime"}]',
    },
    engine: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Table engine (default MergeTree)',
    },
    orderBy: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ORDER BY expression, e.g. "id" or "(id, ts)"',
    },
    partitionBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional PARTITION BY expression, e.g. toYYYYMM(ts)',
    },
  },

  request: {
    url: '/api/tools/clickhouse/create-table',
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
      columns: params.columns,
      engine: params.engine,
      orderBy: params.orderBy,
      partitionBy: params.partitionBy,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'ClickHouse create table failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Table created',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
