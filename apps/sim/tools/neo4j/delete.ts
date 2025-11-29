import type { Neo4jDeleteParams, Neo4jResponse } from '@/tools/neo4j/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<Neo4jDeleteParams, Neo4jResponse> = {
  id: 'neo4j_delete',
  name: 'Neo4j Delete',
  description:
    'Execute DELETE or DETACH DELETE statements to remove nodes and relationships from Neo4j',
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
      description: 'Cypher query with MATCH and DELETE/DETACH DELETE statements',
    },
    parameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parameters for the Cypher query as a JSON object',
    },
    detach: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to use DETACH DELETE to remove relationships before deleting nodes',
    },
  },

  request: {
    url: '/api/tools/neo4j/delete',
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
      detach: params.detach,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Neo4j delete operation failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Delete operation executed successfully',
        summary: data.summary,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    summary: {
      type: 'json',
      description: 'Delete summary with counters for nodes and relationships deleted',
    },
  },
}
