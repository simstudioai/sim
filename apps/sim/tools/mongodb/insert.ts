import type { MongoDBInsertParams, MongoDBResponse } from '@/tools/mongodb/types'
import type { ToolConfig } from '@/tools/types'

export const insertTool: ToolConfig<MongoDBInsertParams, MongoDBResponse> = {
  id: 'mongodb_insert',
  name: 'MongoDB Insert',
  description: 'Insert documents into MongoDB collection',
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
      description: 'Collection name to insert into',
    },
    documents: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of documents to insert',
    },
  },

  request: {
    url: '/api/tools/mongodb/insert',
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
      documents: params.documents,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MongoDB insert failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Documents inserted successfully',
        documentCount: data.documentCount || 0,
        insertedId: data.insertedId,
        insertedIds: data.insertedIds,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    documentCount: { type: 'number', description: 'Number of documents inserted' },
    insertedId: { type: 'string', description: 'ID of inserted document (single insert)' },
    insertedIds: { type: 'array', description: 'Array of inserted document IDs (multiple insert)' },
  },
}
