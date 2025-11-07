import type { MySQLDeleteParams, MySQLResponse } from '@/tools/mysql/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<MySQLDeleteParams, MySQLResponse> = {
  id: 'mysql_delete',
  name: 'MySQL Delete',
  description: 'Delete records from MySQL database',
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
      description: 'Table name to delete from',
    },
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WHERE clause condition (without WHERE keyword)',
    },
  },

  request: {
    url: '/api/tools/mysql/delete',
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
      table: params.table,
      where: params.where,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MySQL delete failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Data deleted successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Array of deleted rows' },
    rowCount: { type: 'number', description: 'Number of rows deleted' },
  },
}
