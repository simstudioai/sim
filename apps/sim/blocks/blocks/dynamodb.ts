import { DynamoDBIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { DynamoDBResponse } from '@/tools/dynamodb/types'

export const DynamoDBBlock: BlockConfig<DynamoDBResponse> = {
  type: 'dynamodb',
  name: 'Amazon DynamoDB',
  description: 'Connect to Amazon DynamoDB',
  longDescription:
    'Integrate Amazon DynamoDB into workflows. Supports Get, Put, Query, Scan, Update, and Delete operations on DynamoDB tables.',
  docsLink: 'https://docs.sim.ai/tools/dynamodb',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: DynamoDBIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Item', id: 'get' },
        { label: 'Put Item', id: 'put' },
        { label: 'Query', id: 'query' },
        { label: 'Scan', id: 'scan' },
        { label: 'Update Item', id: 'update' },
        { label: 'Delete Item', id: 'delete' },
      ],
      value: () => 'get',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'my-table',
      required: true,
    },
    // Key field for get, update, delete operations
    {
      id: 'key',
      title: 'Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'get' },
      required: true,
    },
    {
      id: 'key',
      title: 'Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'key',
      title: 'Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // Consistent read for get
    {
      id: 'consistentRead',
      title: 'Consistent Read',
      type: 'dropdown',
      options: [
        { label: 'Eventually Consistent', id: 'false' },
        { label: 'Strongly Consistent', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get' },
    },
    // Item for put operation
    {
      id: 'item',
      title: 'Item (JSON)',
      type: 'code',
      placeholder:
        '{\n  "pk": "user#123",\n  "name": "John Doe",\n  "email": "john@example.com"\n}',
      condition: { field: 'operation', value: 'put' },
      required: true,
    },
    // Key condition expression for query
    {
      id: 'keyConditionExpression',
      title: 'Key Condition Expression',
      type: 'short-input',
      placeholder: 'pk = :pk',
      condition: { field: 'operation', value: 'query' },
      required: true,
    },
    // Update expression for update operation
    {
      id: 'updateExpression',
      title: 'Update Expression',
      type: 'short-input',
      placeholder: 'SET #name = :name',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    // Filter expression for query and scan
    {
      id: 'filterExpression',
      title: 'Filter Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(email)',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'filterExpression',
      title: 'Filter Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(email)',
      condition: { field: 'operation', value: 'scan' },
    },
    // Projection expression for scan
    {
      id: 'projectionExpression',
      title: 'Projection Expression',
      type: 'short-input',
      placeholder: 'pk, #name, email',
      condition: { field: 'operation', value: 'scan' },
    },
    // Expression attribute names for query, scan, update
    {
      id: 'expressionAttributeNames',
      title: 'Expression Attribute Names (JSON)',
      type: 'code',
      placeholder: '{\n  "#name": "name"\n}',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'expressionAttributeNames',
      title: 'Expression Attribute Names (JSON)',
      type: 'code',
      placeholder: '{\n  "#name": "name"\n}',
      condition: { field: 'operation', value: 'scan' },
    },
    {
      id: 'expressionAttributeNames',
      title: 'Expression Attribute Names (JSON)',
      type: 'code',
      placeholder: '{\n  "#name": "name"\n}',
      condition: { field: 'operation', value: 'update' },
    },
    // Expression attribute values for query, scan, update
    {
      id: 'expressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":pk": "user#123",\n  ":name": "Jane"\n}',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'expressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":status": "active"\n}',
      condition: { field: 'operation', value: 'scan' },
    },
    {
      id: 'expressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":name": "Jane Doe"\n}',
      condition: { field: 'operation', value: 'update' },
    },
    // Index name for query
    {
      id: 'indexName',
      title: 'Index Name',
      type: 'short-input',
      placeholder: 'GSI1',
      condition: { field: 'operation', value: 'query' },
    },
    // Limit for query and scan
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'scan' },
    },
    // Condition expression for update and delete
    {
      id: 'conditionExpression',
      title: 'Condition Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(pk)',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'conditionExpression',
      title: 'Condition Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(pk)',
      condition: { field: 'operation', value: 'delete' },
    },
  ],
  tools: {
    access: [
      'dynamodb_get',
      'dynamodb_put',
      'dynamodb_query',
      'dynamodb_scan',
      'dynamodb_update',
      'dynamodb_delete',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get':
            return 'dynamodb_get'
          case 'put':
            return 'dynamodb_put'
          case 'query':
            return 'dynamodb_query'
          case 'scan':
            return 'dynamodb_scan'
          case 'update':
            return 'dynamodb_update'
          case 'delete':
            return 'dynamodb_delete'
          default:
            throw new Error(`Invalid DynamoDB operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          key,
          item,
          expressionAttributeNames,
          expressionAttributeValues,
          consistentRead,
          limit,
          ...rest
        } = params

        // Parse JSON fields
        const parseJson = (value: unknown, fieldName: string) => {
          if (!value) return undefined
          if (typeof value === 'object') return value
          if (typeof value === 'string' && value.trim()) {
            try {
              return JSON.parse(value)
            } catch (parseError) {
              const errorMsg =
                parseError instanceof Error ? parseError.message : 'Unknown JSON error'
              throw new Error(`Invalid JSON in ${fieldName}: ${errorMsg}`)
            }
          }
          return undefined
        }

        const parsedKey = parseJson(key, 'key')
        const parsedItem = parseJson(item, 'item')
        const parsedExpressionAttributeNames = parseJson(
          expressionAttributeNames,
          'expressionAttributeNames'
        )
        const parsedExpressionAttributeValues = parseJson(
          expressionAttributeValues,
          'expressionAttributeValues'
        )

        // Build connection config
        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        // Build params object
        const result: Record<string, unknown> = {
          ...connectionConfig,
          tableName: rest.tableName,
        }

        if (parsedKey !== undefined) result.key = parsedKey
        if (parsedItem !== undefined) result.item = parsedItem
        if (rest.keyConditionExpression) result.keyConditionExpression = rest.keyConditionExpression
        if (rest.updateExpression) result.updateExpression = rest.updateExpression
        if (rest.filterExpression) result.filterExpression = rest.filterExpression
        if (rest.projectionExpression) result.projectionExpression = rest.projectionExpression
        if (parsedExpressionAttributeNames !== undefined) {
          result.expressionAttributeNames = parsedExpressionAttributeNames
        }
        if (parsedExpressionAttributeValues !== undefined) {
          result.expressionAttributeValues = parsedExpressionAttributeValues
        }
        if (rest.indexName) result.indexName = rest.indexName
        if (limit) result.limit = Number.parseInt(String(limit), 10)
        if (rest.conditionExpression) result.conditionExpression = rest.conditionExpression
        // Handle consistentRead - dropdown sends 'true'/'false' strings or boolean
        if (consistentRead === 'true' || consistentRead === true) {
          result.consistentRead = true
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'DynamoDB operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    tableName: { type: 'string', description: 'DynamoDB table name' },
    key: { type: 'json', description: 'Primary key for get/update/delete operations' },
    item: { type: 'json', description: 'Item to put into the table' },
    keyConditionExpression: { type: 'string', description: 'Key condition for query operations' },
    updateExpression: { type: 'string', description: 'Update expression for update operations' },
    filterExpression: { type: 'string', description: 'Filter expression for query/scan' },
    projectionExpression: { type: 'string', description: 'Attributes to retrieve in scan' },
    expressionAttributeNames: { type: 'json', description: 'Attribute name mappings' },
    expressionAttributeValues: { type: 'json', description: 'Expression attribute values' },
    indexName: { type: 'string', description: 'Secondary index name for query' },
    limit: { type: 'number', description: 'Maximum items to return' },
    conditionExpression: { type: 'string', description: 'Condition for update/delete' },
    consistentRead: { type: 'string', description: 'Use strongly consistent read' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    item: {
      type: 'json',
      description: 'Single item returned from get or update operation',
    },
    items: {
      type: 'array',
      description: 'Array of items returned from query or scan',
    },
    count: {
      type: 'number',
      description: 'Number of items returned',
    },
  },
}
