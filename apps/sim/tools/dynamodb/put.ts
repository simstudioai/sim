import type { DynamoDBPutParams, DynamoDBPutResponse } from '@/tools/dynamodb/types'
import type { ToolConfig } from '@/tools/types'

export const putTool: ToolConfig<DynamoDBPutParams, DynamoDBPutResponse> = {
  id: 'dynamodb_put',
  name: 'DynamoDB Put',
  description: 'Put an item into a DynamoDB table',
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
    item: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Item to put into the table (e.g., {"pk": "USER#123", "name": "John", "email": "john@example.com"})',
    },
  },

  request: {
    url: '/api/tools/dynamodb/put',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      tableName: params.tableName,
      item: params.item,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB put failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Item created successfully',
        item: data.item,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    item: { type: 'object', description: 'Created item' },
  },
}
