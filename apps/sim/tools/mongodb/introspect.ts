import type { MongoDBIntrospectParams, MongoDBIntrospectResponse } from '@/tools/mongodb/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<MongoDBIntrospectParams, MongoDBIntrospectResponse> = {
  id: 'mongodb_introspect',
  name: 'MongoDB Introspect',
  description: 'Introspect MongoDB database to list databases, collections, and indexes',
  version: '1.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MongoDB server hostname or IP address',
    },
    port: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'MongoDB server port (default: 27017)',
    },
    database: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Database name to introspect (e.g., "mydb"). If not provided, lists all databases',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'MongoDB username',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'MongoDB password',
    },
    authSource: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication database',
    },
    ssl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'SSL connection mode (disabled, required, preferred)',
    },
  },

  request: {
    url: '/api/tools/mongodb/introspect',
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
      authSource: params.authSource,
      ssl: params.ssl || 'preferred',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MongoDB introspect failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Introspection completed successfully',
        databases: data.databases || [],
        collections: data.collections || [],
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    databases: { type: 'array', description: 'Array of database names' },
    collections: {
      type: 'array',
      description: 'Array of collection info with name, type, document count, and indexes',
    },
  },
}
