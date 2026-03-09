import type { DynamoDBScanParams, DynamoDBScanResponse } from '@/tools/dynamodb/types'
import type { ToolConfig } from '@/tools/types'

export const scanTool: ToolConfig<DynamoDBScanParams, DynamoDBScanResponse> = {
  id: 'dynamodb_scan',
  name: 'DynamoDB Scan',
  description: 'Scan all items in a DynamoDB table',
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
    filterExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression for results (e.g., "age > :minAge AND #status = :status")',
    },
    projectionExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attributes to retrieve (e.g., "pk, sk, #name, email")',
    },
    expressionAttributeNames: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Attribute name mappings for reserved words (e.g., {"#name": "name", "#status": "status"})',
    },
    expressionAttributeValues: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expression attribute values (e.g., {":minAge": 18, ":status": "active"})',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (e.g., 10, 50, 100)',
    },
  },

  request: {
    url: '/api/tools/dynamodb/scan',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      tableName: params.tableName,
      ...(params.filterExpression && { filterExpression: params.filterExpression }),
      ...(params.projectionExpression && { projectionExpression: params.projectionExpression }),
      ...(params.expressionAttributeNames && {
        expressionAttributeNames: params.expressionAttributeNames,
      }),
      ...(params.expressionAttributeValues && {
        expressionAttributeValues: params.expressionAttributeValues,
      }),
      ...(params.limit && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB scan failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Scan executed successfully',
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
