import {
  MSSQL_TABLE_OUTPUT_PROPERTIES,
  type MSSQLIntrospectParams,
  type MSSQLIntrospectResponse,
} from '@/tools/mssql/types'
import type { InternalToolConfig } from '@/tools/types'

export const introspectTool: InternalToolConfig<MSSQLIntrospectParams, MSSQLIntrospectResponse> = {
  id: 'mssql_introspect',
  name: 'Microsoft SQL Server Introspect',
  description:
    'Introspect a Microsoft SQL Server schema to retrieve table structures, columns, keys, and indexes. Results only cover objects the login can see, so a low-privilege account returns a partial schema rather than an error',
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
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema to introspect (default: dbo)',
    },
  },

  operation: {
    input: (params) => ({
      host: params.host,
      port: Number(params.port) || 1433,
      database: params.database,
      username: params.username,
      password: params.password,
      encrypt: params.encrypt || 'enabled',
      trustServerCertificate: params.trustServerCertificate || 'disabled',
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
      items: { type: 'object', properties: MSSQL_TABLE_OUTPUT_PROPERTIES },
    },
    schemas: {
      type: 'array',
      description: 'List of available schemas in the database',
      items: { type: 'string', description: 'Schema name' },
    },
  },
}
