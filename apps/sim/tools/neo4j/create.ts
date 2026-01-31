import type { Neo4jCreateParams, Neo4jResponse } from '@/tools/neo4j/types'
import type { ToolConfig } from '@/tools/types'

export const createTool: ToolConfig<Neo4jCreateParams, Neo4jResponse> = {
  id: 'neo4j_create',
  name: 'Neo4j Create',
  description:
    'Execute CREATE statements to add new nodes and relationships to Neo4j graph database',
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
        'Cypher CREATE statement to execute (e.g., "CREATE (n:Person {name: $name, age: $age})", "CREATE (a)-[:KNOWS]->(b)")',
    },
    parameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Parameters for the Cypher query as a JSON object (e.g., {"name": "Alice", "age": 30})',
    },
  },

  request: {
    url: '/api/tools/neo4j/create',
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
      throw new Error(data.error || 'Neo4j create operation failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Create operation executed successfully',
        summary: data.summary,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    summary: {
      type: 'json',
      description: 'Creation summary with counters for nodes and relationships created',
    },
  },
}
