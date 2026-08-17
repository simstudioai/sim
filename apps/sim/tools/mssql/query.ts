import type { MSSQLQueryParams, MSSQLQueryResponse } from '@/tools/mssql/types'
import type { ToolConfig } from '@/tools/types'

export const queryTool: ToolConfig<MSSQLQueryParams, MSSQLQueryResponse> = {
  id: 'mssql_query',
  name: 'Microsoft SQL Server Query',
  description: 'Execute a SELECT query on a Microsoft SQL Server database',
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
      description:
        'Server port (default: 1433). A named instance must be reached through its static TCP port',
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
      description:
        'Request TLS encryption for the connection (enabled, disabled). Defaults to enabled. Disabling sends the login packet and every row in cleartext. Enabling requests encryption over TDS 7.4, which the server negotiates during prelogin - a server that answers NOT_SUP yields an unencrypted session rather than an error, so this is a request, not a guarantee',
    },
    trustServerCertificate: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Trust a self-signed server certificate (enabled, disabled). Defaults to disabled. Enabling skips certificate validation, so the connection is open to a machine-in-the-middle',
    },
    connectionTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Connection and request timeout in milliseconds (default: 15000)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'T-SQL SELECT query to execute, optionally led by a WITH clause. Statements that modify data or schema are rejected — use the Execute Raw SQL operation for those.',
    },
  },

  request: {
    url: '/api/tools/mssql/query',
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
      ...(params.connectionTimeout ? { connectionTimeout: Number(params.connectionTimeout) } : {}),
      query: params.query,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Microsoft SQL Server query failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Query executed successfully',
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
        ...(data.truncated && {
          truncated: true,
          truncationReason: data.truncationReason,
        }),
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: { type: 'array', description: 'Array of rows returned from the query' },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    truncated: {
      type: 'boolean',
      description:
        'Present and true only when rows were dropped to stay inside the response ceilings. Absent means the recordset is complete',
    },
    truncationReason: {
      type: 'string',
      description: 'Which ceiling was hit and how to read the remaining rows',
    },
  },
}
