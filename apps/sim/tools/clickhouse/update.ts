import type { ClickHouseUpdateParams, ClickHouseUpdateResponse } from '@/tools/clickhouse/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<ClickHouseUpdateParams, ClickHouseUpdateResponse> = {
  id: 'clickhouse_update',
  name: 'ClickHouse Update',
  description: 'Update rows in a ClickHouse table via an ALTER TABLE ... UPDATE mutation',
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
      description: 'WHERE clause condition (without the WHERE keyword)',
    },
  },

  request: {
    url: '/api/tools/clickhouse/update',
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
      data: params.data,
      where: params.where,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'ClickHouse update failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Update mutation submitted successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Updated rows (empty for ClickHouse mutations)' },
    rowCount: { type: 'number', description: 'Number of rows written by the mutation' },
  },
}
