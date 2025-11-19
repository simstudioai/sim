import type { Neo4jQueryParams, Neo4jResponse } from '@/tools/neo4j/types'
import type { ToolConfig } from '@/tools/types'

export const queryTool: ToolConfig<Neo4jQueryParams, Neo4jResponse> = {
  id: 'neo4j_query',
  name: 'Neo4j Query',
  description: 'Execute MATCH queries to read nodes and relationships from Neo4j graph database',
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
      description: 'Cypher query to execute (typically MATCH statements)',
    },
    parameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parameters for the Cypher query as a JSON object',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return',
    },
  },

  request: {
    url: '/api/tools/neo4j/query',
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
      limit: params.limit ? Number(params.limit) : undefined,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Neo4j query failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Query executed successfully',
        records: data.records || [],
        recordCount: data.recordCount || 0,
        summary: data.summary,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    records: { type: 'array', description: 'Array of records returned from the query' },
    recordCount: { type: 'number', description: 'Number of records returned' },
    summary: { type: 'json', description: 'Query execution summary with timing and counters' },
  },
}
