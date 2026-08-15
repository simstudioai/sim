import type { MSSQLIntrospectParams, MSSQLIntrospectResponse } from '@/tools/mssql/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<MSSQLIntrospectParams, MSSQLIntrospectResponse> = {
  id: 'mssql_introspect',
  name: 'Microsoft SQL Server Introspect',
  description:
    'Introspect a Microsoft SQL Server schema to retrieve table structures, columns, keys, and indexes',
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
      visibility: 'user-or-llm',
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
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema to introspect (default: dbo)',
    },
  },

  request: {
    url: '/api/tools/mssql/introspect',
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
      schema: params.schema || 'dbo',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Microsoft SQL Server introspection failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Schema introspection completed successfully',
        tables: data.tables || [],
        schemas: data.schemas || [],
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
    schemas: { type: 'array', description: 'List of available schemas in the database' },
  },
}
