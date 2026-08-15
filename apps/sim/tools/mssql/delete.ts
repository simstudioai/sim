import type { MSSQLDeleteParams, MSSQLDeleteResponse } from '@/tools/mssql/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<MSSQLDeleteParams, MSSQLDeleteResponse> = {
  id: 'mssql_delete',
  name: 'Microsoft SQL Server Delete',
  description: 'Delete rows from a Microsoft SQL Server table',
  version: '1.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Microsoft SQL Server hostname or IP address',
    },
    port: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Server port (default: 1433). Ignored when a named instance is used',
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
    encrypt: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Encrypt the connection with TLS (enabled, disabled). Defaults to enabled',
    },
    trustServerCertificate: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Trust a self-signed server certificate (enabled, disabled). Defaults to disabled',
    },
    instanceName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Named instance to connect to. Requires the SQL Server Browser service',
    },
    connectionTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Connection timeout in milliseconds (default: 15000)',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name to delete rows from',
    },
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WHERE condition identifying the rows to delete',
    },
  },

  request: {
    url: '/api/tools/mssql/delete',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      host: params.host,
      port: Number(params.port) || 1433,
      database: params.database,
      username: params.username,
      password: params.password,
      encrypt: params.encrypt || 'enabled',
      trustServerCertificate: params.trustServerCertificate || 'disabled',
      ...(params.instanceName ? { instanceName: params.instanceName } : {}),
      ...(params.connectionTimeout ? { connectionTimeout: Number(params.connectionTimeout) } : {}),
      table: params.table,
      where: params.where,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Microsoft SQL Server delete failed')
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
    rows: {
      type: 'array',
      description: 'Rows returned by the statement (empty for a plain DELETE)',
    },
    rowCount: { type: 'number', description: 'Number of rows deleted' },
  },
}
