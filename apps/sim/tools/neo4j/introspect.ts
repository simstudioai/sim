import type { Neo4jIntrospectParams, Neo4jIntrospectResponse } from '@/tools/neo4j/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<Neo4jIntrospectParams, Neo4jIntrospectResponse> = {
  id: 'neo4j_introspect',
  name: 'Neo4j Introspect',
  description:
    'Introspect a Neo4j database to discover its schema including node labels, relationship types, properties, constraints, and indexes.',
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
  },

  request: {
    url: '/api/tools/neo4j/introspect',
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
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Neo4j introspection failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Introspection completed successfully',
        labels: data.labels || [],
        relationshipTypes: data.relationshipTypes || [],
        nodeSchemas: data.nodeSchemas || [],
        relationshipSchemas: data.relationshipSchemas || [],
        constraints: data.constraints || [],
        indexes: data.indexes || [],
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    labels: { type: 'array', description: 'Array of node labels in the database' },
    relationshipTypes: {
      type: 'array',
      description: 'Array of relationship types in the database',
    },
    nodeSchemas: { type: 'array', description: 'Array of node schemas with their properties' },
    relationshipSchemas: {
      type: 'array',
      description: 'Array of relationship schemas with their properties',
    },
    constraints: { type: 'array', description: 'Array of database constraints' },
    indexes: { type: 'array', description: 'Array of database indexes' },
  },
}
