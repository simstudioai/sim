import type { DynamoDBQueryParams, DynamoDBQueryResponse } from '@/tools/dynamodb/types'
import type { ToolConfig } from '@/tools/types'

export const queryTool: ToolConfig<DynamoDBQueryParams, DynamoDBQueryResponse> = {
  id: 'dynamodb_query',
  name: 'DynamoDB Query',
  description: 'Query items from a DynamoDB table using key conditions',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'DynamoDB table name (e.g., "Users", "Orders")',
    },
    keyConditionExpression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Key condition expression (e.g., "pk = :pk" or "pk = :pk AND sk BEGINS_WITH :prefix")',
    },
    filterExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression for results (e.g., "age > :minAge AND #status = :status")',
    },
    expressionAttributeNames: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attribute name mappings for reserved words (e.g., {"#status": "status"})',
    },
    expressionAttributeValues: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expression attribute values (e.g., {":pk": "USER#123", ":minAge": 18})',
    },
    indexName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Secondary index name to query (e.g., "GSI1", "email-index")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (e.g., 10, 50, 100)',
    },
  },

  request: {
    url: '/api/tools/dynamodb/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      tableName: params.tableName,
      keyConditionExpression: params.keyConditionExpression,
      ...(params.filterExpression && { filterExpression: params.filterExpression }),
      ...(params.expressionAttributeNames && {
        expressionAttributeNames: params.expressionAttributeNames,
      }),
      ...(params.expressionAttributeValues && {
        expressionAttributeValues: params.expressionAttributeValues,
      }),
      ...(params.indexName && { indexName: params.indexName }),
      ...(params.limit && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB query failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Query executed successfully',
        items: data.items || [],
        count: data.count || 0,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    items: { type: 'array', description: 'Array of items returned' },
    count: { type: 'number', description: 'Number of items returned' },
  },
}
