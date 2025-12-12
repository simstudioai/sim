import type { MongoDBExecuteParams, MongoDBResponse } from '@/tools/mongodb/types'
import type { ToolConfig } from '@/tools/types'

export const executeTool: ToolConfig<MongoDBExecuteParams, MongoDBResponse> = {
  id: 'mongodb_execute',
  name: 'MongoDB Execute',
  description: 'Execute MongoDB aggregation pipeline',
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
      description: 'Collection name to execute pipeline on',
    },
    pipeline: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Aggregation pipeline as JSON string',
    },
  },

  request: {
    url: '/api/tools/mongodb/execute',
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
      pipeline: params.pipeline,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MongoDB aggregation failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Aggregation executed successfully',
        documents: data.documents || [],
        documentCount: data.documentCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    documents: { type: 'array', description: 'Array of documents returned from aggregation' },
    documentCount: { type: 'number', description: 'Number of documents returned' },
  },
}
