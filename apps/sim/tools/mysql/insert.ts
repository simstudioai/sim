import type { MySQLInsertParams, MySQLResponse } from '@/tools/mysql/types'
import type { ToolConfig } from '@/tools/types'

export const insertTool: ToolConfig<MySQLInsertParams, MySQLResponse> = {
  id: 'mysql_insert',
  name: 'MySQL Insert',
  description: 'Insert new record into MySQL database',
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
      visibility: 'user-only',
      description: 'Database name to connect to',
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
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name to insert into',
    },
    data: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data to insert as key-value pairs',
    },
  },

  request: {
    url: '/api/tools/mysql/insert',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      ssl: params.ssl || 'required',
      table: params.table,
      data: params.data,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MySQL insert failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Data inserted successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Array of inserted rows' },
    rowCount: { type: 'number', description: 'Number of rows inserted' },
  },
}
