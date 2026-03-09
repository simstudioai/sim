import type { PostgresIntrospectParams, PostgresIntrospectResponse } from '@/tools/postgresql/types'
import { POSTGRES_TABLE_OUTPUT_PROPERTIES } from '@/tools/postgresql/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<PostgresIntrospectParams, PostgresIntrospectResponse> = {
  id: 'postgresql_introspect',
  name: 'PostgreSQL Introspect',
  description:
    'Introspect PostgreSQL database schema to retrieve table structures, columns, and relationships',
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
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema to introspect (default: public)',
    },
  },

  request: {
    url: '/api/tools/postgresql/introspect',
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
      schema: params.schema || 'public',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'PostgreSQL introspection failed')
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
      items: {
        type: 'object',
        properties: POSTGRES_TABLE_OUTPUT_PROPERTIES,
      },
    },
    schemas: {
      type: 'array',
      description: 'List of available schemas in the database',
      items: { type: 'string', description: 'Schema name' },
    },
  },
}
