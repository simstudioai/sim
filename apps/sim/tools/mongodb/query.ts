import type { MongoDBQueryParams, MongoDBResponse } from '@/tools/mongodb/types'
import type { ToolConfig } from '@/tools/types'

export const queryTool: ToolConfig<MongoDBQueryParams, MongoDBResponse> = {
  id: 'mongodb_query',
  name: 'MongoDB Query',
  description: 'Execute find operation on MongoDB collection',
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
      description: 'Collection name to query',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'MongoDB query filter as JSON string',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of documents to return',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort criteria as JSON string',
    },
  },

  request: {
    url: '/api/tools/mongodb/query',
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
      query: params.query,
      limit: params.limit ? Number(params.limit) : undefined,
      sort: params.sort,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'MongoDB query failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Query executed successfully',
        documents: data.documents || [],
        documentCount: data.documentCount || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    documents: { type: 'array', description: 'Array of documents returned from the query' },
    documentCount: { type: 'number', description: 'Number of documents returned' },
  },
}
