import type { DynamoDBIntrospectParams, DynamoDBIntrospectResponse } from '@/tools/dynamodb/types'
import type { ToolConfig } from '@/tools/types'

export const introspectTool: ToolConfig<DynamoDBIntrospectParams, DynamoDBIntrospectResponse> = {
  id: 'dynamodb_introspect',
  name: 'DynamoDB Introspect',
  description:
    'Introspect DynamoDB to list tables or get detailed schema information for a specific table',
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
    tableName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional table name to get detailed schema (e.g., "Users", "Orders"). If not provided, lists all tables.',
    },
  },

  request: {
    url: '/api/tools/dynamodb/introspect',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      ...(params.tableName && { tableName: params.tableName }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB introspection failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Introspection completed successfully',
        tables: data.tables || [],
        tableDetails: data.tableDetails,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    tables: { type: 'array', description: 'List of table names in the region' },
    tableDetails: {
      type: 'object',
      description: 'Detailed schema information for a specific table',
    },
  },
}
