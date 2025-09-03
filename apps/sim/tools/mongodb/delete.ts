import type { MongoDBDeleteParams, MongoDBResponse } from '@/tools/mongodb/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<MongoDBDeleteParams, MongoDBResponse> = {
  id: 'mongodb_delete',
  name: 'MongoDB Delete',
  description: 'Delete documents from MongoDB collection',
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
      required: true,
      visibility: 'user-only',
      description: 'Database name to connect to',
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
    collection: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Collection name to delete from',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Filter criteria as JSON string',
    },
    multi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delete multiple documents',
    },
  },

  request: {
    url: '/api/tools/mongodb/delete',
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
      authSource: params.authSource,
      ssl: params.ssl || 'preferred',
      collection: params.collection,
      filter: params.filter,
      multi: params.multi || false,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MongoDB delete failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Documents deleted successfully',
        deletedCount: data.deletedCount || 0,
        documentCount: data.documentCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    deletedCount: { type: 'number', description: 'Number of documents deleted' },
    documentCount: { type: 'number', description: 'Total number of documents affected' },
  },
}
