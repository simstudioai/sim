import type { Neo4jMergeParams, Neo4jResponse } from '@/tools/neo4j/types'
import type { ToolConfig } from '@/tools/types'

export const mergeTool: ToolConfig<Neo4jMergeParams, Neo4jResponse> = {
  id: 'neo4j_merge',
  name: 'Neo4j Merge',
  description:
    'Execute MERGE statements to find or create nodes and relationships in Neo4j (upsert operation)',
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
      visibility: 'user-or-llm',
      description: 'Database name to connect to (e.g., "neo4j", "movies", "social")',
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
      description:
        'Cypher MERGE statement to execute (e.g., "MERGE (n:Person {name: $name}) ON CREATE SET n.created = timestamp()", "MERGE (a)-[r:KNOWS]->(b)")',
    },
    parameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Parameters for the Cypher query as a JSON object (e.g., {"name": "Alice", "email": "alice@example.com"})',
    },
  },

  request: {
    url: '/api/tools/neo4j/merge',
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
      throw new Error(data.error || 'Neo4j merge operation failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Merge operation executed successfully',
        summary: data.summary,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    summary: {
      type: 'json',
      description: 'Merge summary with counters for nodes/relationships created or matched',
    },
  },
}
