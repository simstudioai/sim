import type { DynamoDBGetParams, DynamoDBGetResponse } from '@/tools/dynamodb/types'
import type { ToolConfig } from '@/tools/types'

export const getTool: ToolConfig<DynamoDBGetParams, DynamoDBGetResponse> = {
  id: 'dynamodb_get',
  name: 'DynamoDB Get',
  description: 'Get an item from a DynamoDB table by primary key',
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
    key: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Primary key of the item to retrieve (e.g., {"pk": "USER#123"} or {"pk": "ORDER#456", "sk": "ITEM#789"})',
    },
    consistentRead: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use strongly consistent read',
    },
  },

  request: {
    url: '/api/tools/dynamodb/get',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      tableName: params.tableName,
      key: params.key,
      ...(params.consistentRead !== undefined && { consistentRead: params.consistentRead }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB get failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Item retrieved successfully',
        item: data.item,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    item: { type: 'object', description: 'Retrieved item' },
  },
}
