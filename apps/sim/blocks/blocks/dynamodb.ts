import { DynamoDBIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { DynamoDBIntrospectResponse, DynamoDBResponse } from '@/tools/dynamodb/types'

export const DynamoDBBlock: BlockConfig<DynamoDBResponse | DynamoDBIntrospectResponse> = {
  type: 'dynamodb',
  name: 'Amazon DynamoDB',
  description: 'Connect to Amazon DynamoDB',
  longDescription:
    'Integrate Amazon DynamoDB into workflows. Supports Get, Put, Query, Scan, Update, Delete, and Introspect operations on DynamoDB tables.',
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
        { label: 'Introspect', id: 'introspect' },
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
      condition: {
        field: 'operation',
        value: 'introspect',
        not: true,
      },
    },
    {
      id: 'tableName',
      title: 'Table Name (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty to list all tables',
      required: false,
      condition: { field: 'operation', value: 'introspect' },
    },
    // Key field for get, update, delete operations
    {
      id: 'key',
      title: 'Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'get' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB primary key JSON object based on the user's description.
The key should include partition key and optionally sort key.
Examples:
- {"pk": "user#123"} - Simple partition key
- {"pk": "order#456", "sk": "2024-01-15"} - Partition key with sort key

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the item key...',
        generationType: 'json-object',
      },
    },
    {
      id: 'key',
      title: 'Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB primary key JSON object based on the user's description.
The key should include partition key and optionally sort key.
Examples:
- {"pk": "user#123"} - Simple partition key
- {"pk": "order#456", "sk": "2024-01-15"} - Partition key with sort key

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the item key...',
        generationType: 'json-object',
      },
    },
    {
      id: 'key',
      title: 'Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'delete' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB primary key JSON object based on the user's description.
The key should include partition key and optionally sort key.
Examples:
- {"pk": "user#123"} - Simple partition key
- {"pk": "order#456", "sk": "2024-01-15"} - Partition key with sort key

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the item key...',
        generationType: 'json-object',
      },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB item JSON object based on the user's description.
The item must include the primary key and any additional attributes.
Use appropriate data types for values (strings, numbers, booleans, lists, maps).

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the item you want to store...',
        generationType: 'json-object',
      },
    },
    // Key condition expression for query
    {
      id: 'keyConditionExpression',
      title: 'Key Condition Expression',
      type: 'short-input',
      placeholder: 'pk = :pk',
      condition: { field: 'operation', value: 'query' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB key condition expression based on the user's description.
The expression must reference the partition key and optionally the sort key.
Use :placeholders for values and #names for reserved words.
Examples:
- "pk = :pk" - Match partition key
- "pk = :pk AND sk BETWEEN :start AND :end" - Range query on sort key
- "pk = :pk AND begins_with(sk, :prefix)" - Prefix match on sort key

Return ONLY the expression - no explanations.`,
        placeholder: 'Describe the key condition...',
      },
    },
    // Update expression for update operation
    {
      id: 'updateExpression',
      title: 'Update Expression',
      type: 'short-input',
      placeholder: 'SET #name = :name',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB update expression based on the user's description.
Use SET, REMOVE, ADD, or DELETE clauses.
Use :placeholders for values and #names for attribute names.
Examples:
- "SET #name = :name, #age = :age" - Update multiple attributes
- "SET #count = #count + :increment" - Increment a counter
- "REMOVE #oldAttribute" - Remove an attribute

Return ONLY the expression - no explanations.`,
        placeholder: 'Describe what updates to make...',
      },
    },
    // Filter expression for query and scan
    {
      id: 'filterExpression',
      title: 'Filter Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(email)',
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB filter expression based on the user's description.
Filter expressions are applied after the query but before results are returned.
Use comparison operators, functions like attribute_exists(), contains(), begins_with().
Examples:
- "attribute_exists(email)" - Items with email attribute
- "#status = :active AND #age > :minAge" - Multiple conditions
- "contains(#tags, :tag)" - Contains a value in a list

Return ONLY the expression - no explanations.`,
        placeholder: 'Describe how to filter results...',
      },
    },
    {
      id: 'filterExpression',
      title: 'Filter Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(email)',
      condition: { field: 'operation', value: 'scan' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB filter expression based on the user's description.
Filter expressions are applied after the scan but before results are returned.
Use comparison operators, functions like attribute_exists(), contains(), begins_with().
Examples:
- "attribute_exists(email)" - Items with email attribute
- "#status = :active AND #age > :minAge" - Multiple conditions
- "contains(#tags, :tag)" - Contains a value in a list

Return ONLY the expression - no explanations.`,
        placeholder: 'Describe how to filter results...',
      },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute names JSON based on the user's description.
Map placeholder names (starting with #) to actual attribute names.
Required when using reserved words or for clarity.
Example: {"#name": "name", "#status": "status"}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute name mappings...',
        generationType: 'json-object',
      },
    },
    {
      id: 'expressionAttributeNames',
      title: 'Expression Attribute Names (JSON)',
      type: 'code',
      placeholder: '{\n  "#name": "name"\n}',
      condition: { field: 'operation', value: 'scan' },
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute names JSON based on the user's description.
Map placeholder names (starting with #) to actual attribute names.
Required when using reserved words or for clarity.
Example: {"#name": "name", "#status": "status"}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute name mappings...',
        generationType: 'json-object',
      },
    },
    {
      id: 'expressionAttributeNames',
      title: 'Expression Attribute Names (JSON)',
      type: 'code',
      placeholder: '{\n  "#name": "name"\n}',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute names JSON based on the user's description.
Map placeholder names (starting with #) to actual attribute names.
Required when using reserved words or for clarity.
Example: {"#name": "name", "#status": "status"}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute name mappings...',
        generationType: 'json-object',
      },
    },
    // Expression attribute values for query, scan, update
    {
      id: 'expressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":pk": "user#123",\n  ":name": "Jane"\n}',
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute values JSON based on the user's description.
Map placeholder values (starting with :) to actual values.
Example: {":pk": "user#123", ":status": "active", ":minAge": 18}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute values...',
        generationType: 'json-object',
      },
    },
    {
      id: 'expressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":status": "active"\n}',
      condition: { field: 'operation', value: 'scan' },
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute values JSON based on the user's description.
Map placeholder values (starting with :) to actual values.
Example: {":status": "active", ":minAge": 18}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute values...',
        generationType: 'json-object',
      },
    },
    {
      id: 'expressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":name": "Jane Doe"\n}',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute values JSON based on the user's description.
Map placeholder values (starting with :) to actual values.
Example: {":name": "Jane Doe", ":count": 1}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute values...',
        generationType: 'json-object',
      },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB condition expression based on the user's description.
Condition expressions prevent the operation if the condition is not met.
Examples:
- "attribute_exists(pk)" - Item must exist
- "attribute_not_exists(pk)" - Item must not exist (for inserts)
- "#version = :expectedVersion" - Optimistic locking

Return ONLY the expression - no explanations.`,
        placeholder: 'Describe the condition that must be true...',
      },
    },
    {
      id: 'conditionExpression',
      title: 'Condition Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(pk)',
      condition: { field: 'operation', value: 'delete' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB condition expression based on the user's description.
Condition expressions prevent the operation if the condition is not met.
Examples:
- "attribute_exists(pk)" - Item must exist
- "#status = :deletable" - Only delete if status matches

Return ONLY the expression - no explanations.`,
        placeholder: 'Describe the condition that must be true...',
      },
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
      'dynamodb_introspect',
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
          case 'introspect':
            return 'dynamodb_introspect'
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
    tables: {
      type: 'array',
      description: 'List of table names from introspect operation',
    },
    tableDetails: {
      type: 'json',
      description: 'Detailed schema information for a specific table from introspect operation',
    },
  },
}
