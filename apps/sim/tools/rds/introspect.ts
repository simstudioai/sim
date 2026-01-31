import type { RdsIntrospectParams, RdsIntrospectResponse } from '@/tools/rds/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<RdsIntrospectParams, RdsIntrospectResponse> = {
  id: 'rds_introspect',
  name: 'RDS Introspect',
  description:
    'Introspect Amazon RDS Aurora database schema to retrieve table structures, columns, and relationships',
  version: '1.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    resourceArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ARN of the Aurora DB cluster (e.g., arn:aws:rds:us-east-1:123456789012:cluster:my-cluster)',
    },
    secretArn: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ARN of the Secrets Manager secret containing DB credentials',
    },
    database: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Database name to connect to (e.g., mydb, production_db)',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema to introspect (default: public for PostgreSQL, database name for MySQL)',
    },
    engine: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Database engine (aurora-postgresql or aurora-mysql). Auto-detected if not provided.',
    },
  },

  request: {
    url: '/api/tools/rds/introspect',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      resourceArn: params.resourceArn,
      secretArn: params.secretArn,
      ...(params.database && { database: params.database }),
      ...(params.schema && { schema: params.schema }),
      ...(params.engine && { engine: params.engine }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'RDS introspection failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Schema introspection completed successfully',
        engine: data.engine || 'unknown',
        tables: data.tables || [],
        schemas: data.schemas || [],
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    engine: { type: 'string', description: 'Detected database engine type' },
    tables: {
      type: 'array',
      description: 'Array of table schemas with columns, keys, and indexes',
    },
    schemas: { type: 'array', description: 'List of available schemas in the database' },
  },
}
