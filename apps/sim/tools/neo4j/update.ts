import type { Neo4jResponse, Neo4jUpdateParams } from '@/tools/neo4j/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<Neo4jUpdateParams, Neo4jResponse> = {
  id: 'neo4j_update',
  name: 'Neo4j Update',
  description:
    'Execute SET statements to update properties of existing nodes and relationships in Neo4j',
  version: '1.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Neo4j server hostname or IP address',
    },
    port: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'Neo4j server port (default: 7687 for Bolt protocol)',
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
      description: 'Neo4j username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Neo4j password',
    },
    encryption: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Connection encryption mode (enabled, disabled)',
    },
    cypherQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cypher query with MATCH and SET statements to update properties',
    },
    parameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parameters for the Cypher query as a JSON object',
    },
  },

  request: {
    url: '/api/tools/neo4j/update',
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
      encryption: params.encryption || 'disabled',
      cypherQuery: params.cypherQuery,
      parameters: params.parameters,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Neo4j update operation failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Update operation executed successfully',
        summary: data.summary,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    summary: { type: 'json', description: 'Update summary with counters for properties set' },
  },
}
