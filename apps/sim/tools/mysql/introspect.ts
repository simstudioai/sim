import type { MySQLIntrospectParams, MySQLIntrospectResponse } from '@/tools/mysql/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<MySQLIntrospectParams, MySQLIntrospectResponse> = {
  id: 'mysql_introspect',
  name: 'MySQL Introspect',
  description:
    'Introspect MySQL database schema to retrieve table structures, columns, and relationships',
  version: '1.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MySQL server hostname or IP address',
    },
    port: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'MySQL server port (default: 3306)',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Database name to connect to (e.g., my_database)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Database username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Database password',
    },
    ssl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'SSL connection mode (disabled, required, preferred)',
    },
  },

  request: {
    url: '/api/tools/mysql/introspect',
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
      ssl: params.ssl || 'required',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MySQL introspection failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Schema introspection completed successfully',
        tables: data.tables || [],
        databases: data.databases || [],
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    tables: {
      type: 'array',
      description: 'Array of table schemas with columns, keys, and indexes',
    },
    databases: { type: 'array', description: 'List of available databases on the server' },
  },
}
