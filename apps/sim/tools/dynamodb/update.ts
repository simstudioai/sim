import type { DynamoDBUpdateParams, DynamoDBUpdateResponse } from '@/tools/dynamodb/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<DynamoDBUpdateParams, DynamoDBUpdateResponse> = {
  id: 'dynamodb_update',
  name: 'DynamoDB Update',
  description: 'Update an item in a DynamoDB table',
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
        'Primary key of the item to update (e.g., {"pk": "USER#123"} or {"pk": "ORDER#456", "sk": "ITEM#789"})',
    },
    updateExpression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Update expression (e.g., "SET #name = :name, age = :age" or "SET #count = #count + :inc")',
    },
    expressionAttributeNames: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Attribute name mappings for reserved words (e.g., {"#name": "name", "#count": "count"})',
    },
    expressionAttributeValues: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expression attribute values (e.g., {":name": "John", ":age": 30, ":inc": 1})',
    },
    conditionExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Condition that must be met for the update to succeed (e.g., "attribute_exists(pk)" or "version = :expectedVersion")',
    },
  },

  request: {
    url: '/api/tools/dynamodb/update',
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
      updateExpression: params.updateExpression,
      ...(params.expressionAttributeNames && {
        expressionAttributeNames: params.expressionAttributeNames,
      }),
      ...(params.expressionAttributeValues && {
        expressionAttributeValues: params.expressionAttributeValues,
      }),
      ...(params.conditionExpression && { conditionExpression: params.conditionExpression }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'DynamoDB update failed')
    }

    return {
      success: true,
      output: {
        message: data.message || 'Item updated successfully',
        item: data.item,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    item: { type: 'object', description: 'Updated item' },
  },
}
