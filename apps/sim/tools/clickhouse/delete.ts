import type { ClickHouseDeleteParams, ClickHouseDeleteResponse } from '@/tools/clickhouse/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteTool: InternalToolConfig<ClickHouseDeleteParams, ClickHouseDeleteResponse> = {
  id: 'clickhouse_delete',
  name: 'ClickHouse Delete',
  description: 'Delete rows from a ClickHouse table via an ALTER TABLE ... DELETE mutation',
  version: '1.0.0',

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
      description: 'Table name to delete data from',
    },
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WHERE clause condition (without the WHERE keyword)',
    },
  },

  operation: {
    input: (params) => ({
      host: params.host,
      port: Number(params.port),
      database: params.database,
      username: params.username,
      password: params.password,
      secure: params.secure,
      table: params.table,
      where: params.where,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'ClickHouse delete failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Delete mutation submitted successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Deleted rows (empty for ClickHouse mutations)' },
    rowCount: { type: 'number', description: 'Number of rows affected by the mutation' },
  },
}
