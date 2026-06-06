import type {
  ClickHouseDdlResponse,
  ClickHouseShowCreateTableParams,
} from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const showCreateTableTool: ToolConfig<
  ClickHouseShowCreateTableParams,
  ClickHouseDdlResponse
> = {
  id: 'clickhouse_show_create_table',
  name: 'ClickHouse Show Create Table',
  description: 'Get the CREATE TABLE statement (DDL) for a ClickHouse table',
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
      description: 'Table name to get the CREATE statement for',
    },
  },

  request: {
    url: '/api/tools/clickhouse/show-create-table',
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
      throw new Error(data.error || 'ClickHouse show create table failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'CREATE statement retrieved',
        ddl: data.ddl ?? '',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    ddl: { type: 'string', description: 'The CREATE TABLE statement' },
  },
}
