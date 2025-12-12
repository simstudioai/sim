import type { MongoDBResponse, MongoDBUpdateParams } from '@/tools/mongodb/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<MongoDBUpdateParams, MongoDBResponse> = {
  id: 'mongodb_update',
  name: 'MongoDB Update',
  description: 'Update documents in MongoDB collection',
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
      description: 'Collection name to update',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Filter criteria as JSON string',
    },
    update: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Update operations as JSON string',
    },
    upsert: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create document if not found',
    },
    multi: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Update multiple documents',
    },
  },

  request: {
    url: '/api/tools/mongodb/update',
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
      collection: params.collection,
      filter: params.filter,
      update: params.update,
      upsert: params.upsert || false,
      multi: params.multi || false,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MongoDB update failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Documents updated successfully',
        matchedCount: data.matchedCount || 0,
        modifiedCount: data.modifiedCount || 0,
        documentCount: data.documentCount || 0,
        insertedId: data.insertedId,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    matchedCount: { type: 'number', description: 'Number of documents matched by filter' },
    modifiedCount: { type: 'number', description: 'Number of documents modified' },
    documentCount: { type: 'number', description: 'Total number of documents affected' },
    insertedId: { type: 'string', description: 'ID of inserted document (if upsert)' },
  },
}
