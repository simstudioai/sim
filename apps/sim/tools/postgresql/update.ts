import type { PostgresUpdateParams, PostgresUpdateResponse } from '@/tools/postgresql/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<PostgresUpdateParams, PostgresUpdateResponse> = {
  id: 'postgresql_update',
  name: 'PostgreSQL Update',
  description: 'Update data in PostgreSQL database',
  version: '1.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostgreSQL server hostname or IP address',
    },
    port: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'PostgreSQL server port (default: 5432)',
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
      description: 'Table name to update data in',
    },
    data: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data object with fields to update (key-value pairs)',
    },
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WHERE clause condition (without WHERE keyword)',
    },
  },

  request: {
    url: '/api/tools/postgresql/update',
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
      where: params.where,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'PostgreSQL update failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Data updated successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Updated data (if RETURNING clause used)' },
    rowCount: { type: 'number', description: 'Number of rows updated' },
  },
}
