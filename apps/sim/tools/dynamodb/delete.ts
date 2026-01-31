import type { DynamoDBDeleteParams, DynamoDBDeleteResponse } from '@/tools/dynamodb/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<DynamoDBDeleteParams, DynamoDBDeleteResponse> = {
  id: 'dynamodb_delete',
  name: 'DynamoDB Delete',
  description: 'Delete an item from a DynamoDB table',
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
        'Primary key of the item to delete (e.g., {"pk": "USER#123"} or {"pk": "ORDER#456", "sk": "ITEM#789"})',
    },
    conditionExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Condition that must be met for the delete to succeed (e.g., "attribute_exists(pk)")',
    },
  },

  request: {
    url: '/api/tools/dynamodb/delete',
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
      ...(params.conditionExpression && { conditionExpression: params.conditionExpression }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB delete failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Item deleted successfully',
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
  },
}
