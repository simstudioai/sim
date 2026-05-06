import { toError } from '@sim/utils/errors'
import { DynamoDBIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { DynamoDBIntrospectResponse, DynamoDBResponse } from '@/tools/dynamodb/types'

export const DynamoDBBlock: BlockConfig<DynamoDBResponse | DynamoDBIntrospectResponse> = {
  type: 'dynamodb',
  name: 'Amazon DynamoDB',
  description: 'Get, put, query, scan, update, and delete items in Amazon DynamoDB tables',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Amazon DynamoDB into workflows. Supports Get, Put, Query, Scan, Update, Delete, and Introspect operations on DynamoDB tables.',
  docsLink: 'https://docs.sim.ai/tools/dynamodb',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  tags: ['cloud', 'data-warehouse'],
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
      id: 'introspectTableName',
      title: 'Table Name (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty to list all tables',
      required: false,
      condition: { field: 'operation', value: 'introspect' },
    },
    {
      id: 'getKey',
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
      id: 'updateKey',
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
      id: 'deleteKey',
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
      mode: 'advanced',
    },
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
    {
      id: 'queryFilterExpression',
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
      id: 'scanFilterExpression',
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
    {
      id: 'projectionExpression',
      title: 'Projection Expression',
      type: 'short-input',
      placeholder: 'pk, #name, email',
      condition: { field: 'operation', value: 'scan' },
    },
    {
      id: 'queryExpressionAttributeNames',
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
      id: 'scanExpressionAttributeNames',
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
      id: 'updateExpressionAttributeNames',
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
    {
      id: 'putExpressionAttributeNames',
      title: 'Expression Attribute Names (JSON)',
      type: 'code',
      placeholder: '{\n  "#name": "name"\n}',
      condition: { field: 'operation', value: 'put' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute names JSON based on the user's description.
Map placeholder names (starting with #) to actual attribute names used in the condition expression.
Example: {"#name": "name", "#status": "status"}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute name mappings...',
        generationType: 'json-object',
      },
    },
    {
      id: 'deleteExpressionAttributeNames',
      title: 'Expression Attribute Names (JSON)',
      type: 'code',
      placeholder: '{\n  "#status": "status"\n}',
      condition: { field: 'operation', value: 'delete' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute names JSON based on the user's description.
Map placeholder names (starting with #) to actual attribute names used in the condition expression.
Example: {"#status": "status"}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute name mappings...',
        generationType: 'json-object',
      },
    },
    {
      id: 'queryExpressionAttributeValues',
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
      id: 'scanExpressionAttributeValues',
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
      id: 'updateExpressionAttributeValues',
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
    {
      id: 'putExpressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":expected": "value"\n}',
      condition: { field: 'operation', value: 'put' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute values JSON based on the user's description.
Map placeholder values (starting with :) to actual values used in the condition expression.
Example: {":expectedVersion": 3}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute values...',
        generationType: 'json-object',
      },
    },
    {
      id: 'deleteExpressionAttributeValues',
      title: 'Expression Attribute Values (JSON)',
      type: 'code',
      placeholder: '{\n  ":status": "active"\n}',
      condition: { field: 'operation', value: 'delete' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate DynamoDB expression attribute values JSON based on the user's description.
Map placeholder values (starting with :) to actual values used in the condition expression.
Example: {":status": "active", ":version": 3}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the attribute values...',
        generationType: 'json-object',
      },
    },
    {
      id: 'indexName',
      title: 'Index Name',
      type: 'short-input',
      placeholder: 'GSI1',
      condition: { field: 'operation', value: 'query' },
      mode: 'advanced',
    },
    {
      id: 'queryLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
      mode: 'advanced',
    },
    {
      id: 'scanLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'scan' },
      mode: 'advanced',
    },
    {
      id: 'putConditionExpression',
      title: 'Condition Expression',
      type: 'short-input',
      placeholder: 'attribute_not_exists(pk)',
      condition: { field: 'operation', value: 'put' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a DynamoDB condition expression based on the user's description.
Condition expressions prevent the operation if the condition is not met.
Examples:
- "attribute_not_exists(pk)" - Prevent overwriting an existing item
- "#version = :expectedVersion" - Optimistic locking

Return ONLY the expression - no explanations.`,
        placeholder: 'Describe the condition that must be true...',
      },
    },
    {
      id: 'updateConditionExpression',
      title: 'Condition Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(pk)',
      condition: { field: 'operation', value: 'update' },
      mode: 'advanced',
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
      id: 'deleteConditionExpression',
      title: 'Condition Expression',
      type: 'short-input',
      placeholder: 'attribute_exists(pk)',
      condition: { field: 'operation', value: 'delete' },
      mode: 'advanced',
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
    {
      id: 'queryExclusiveStartKey',
      title: 'Exclusive Start Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'query' },
      mode: 'advanced',
    },
    {
      id: 'scanExclusiveStartKey',
      title: 'Exclusive Start Key (JSON)',
      type: 'code',
      placeholder: '{\n  "pk": "user#123"\n}',
      condition: { field: 'operation', value: 'scan' },
      mode: 'advanced',
    },
    {
      id: 'scanIndexForward',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending (default)', id: 'true' },
        { label: 'Descending', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'query' },
      mode: 'advanced',
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
        const parseJson = (value: unknown, fieldName: string) => {
          if (!value) return undefined
          if (typeof value === 'object') return value
          if (typeof value === 'string' && value.trim()) {
            try {
              return JSON.parse(value)
            } catch (parseError) {
              throw new Error(`Invalid JSON in ${fieldName}: ${toError(parseError).message}`)
            }
          }
          return undefined
        }

        const op = params.operation as string
        const result: Record<string, unknown> = {
          region: params.region,
          accessKeyId: params.accessKeyId,
          secretAccessKey: params.secretAccessKey,
        }

        // Table name (introspect uses introspectTableName, all others use tableName).
        // Legacy blocks stored both operations under 'tableName'; fall back to tableName
        // for introspect if introspectTableName is not present (migration grace period).
        if (op === 'introspect') {
          const tbl = params.introspectTableName || params.tableName
          if (tbl) result.tableName = tbl
        } else {
          result.tableName = params.tableName
        }

        // Operation-specific params — map unique subBlock IDs back to tool param names.
        // Where a fallback to the legacy migrated ID is present (e.g. params.getKey as
        // fallback for update/delete), it covers blocks saved before the subblock rename
        // whose migration entry routed the shared old ID to the query/get slot.
        if (op === 'get') {
          const key = parseJson(params.getKey, 'key')
          if (key !== undefined) result.key = key
          if (params.consistentRead === 'true' || params.consistentRead === true) {
            result.consistentRead = true
          }
        }

        if (op === 'put') {
          const item = parseJson(params.item, 'item')
          if (item !== undefined) result.item = item
          // conditionExpression: fall back to updateConditionExpression (legacy migration target)
          const condExpr = params.putConditionExpression || params.updateConditionExpression
          if (condExpr) result.conditionExpression = condExpr
          // expressionAttributeNames: fall back to queryExpressionAttributeNames (legacy migration target)
          const names = parseJson(
            params.putExpressionAttributeNames || params.queryExpressionAttributeNames,
            'expressionAttributeNames'
          )
          if (names !== undefined) result.expressionAttributeNames = names
          // expressionAttributeValues: fall back to queryExpressionAttributeValues (legacy migration target)
          const values = parseJson(
            params.putExpressionAttributeValues || params.queryExpressionAttributeValues,
            'expressionAttributeValues'
          )
          if (values !== undefined) result.expressionAttributeValues = values
        }

        if (op === 'query') {
          if (params.keyConditionExpression)
            result.keyConditionExpression = params.keyConditionExpression
          if (params.queryFilterExpression) result.filterExpression = params.queryFilterExpression
          const names = parseJson(params.queryExpressionAttributeNames, 'expressionAttributeNames')
          if (names !== undefined) result.expressionAttributeNames = names
          const values = parseJson(
            params.queryExpressionAttributeValues,
            'expressionAttributeValues'
          )
          if (values !== undefined) result.expressionAttributeValues = values
          if (params.indexName) result.indexName = params.indexName
          if (params.queryLimit) result.limit = Number.parseInt(String(params.queryLimit), 10)
          const esk = parseJson(params.queryExclusiveStartKey, 'exclusiveStartKey')
          if (esk !== undefined) result.exclusiveStartKey = esk
          if (params.scanIndexForward === 'false' || params.scanIndexForward === false) {
            result.scanIndexForward = false
          }
        }

        if (op === 'scan') {
          // filterExpression: fall back to queryFilterExpression (legacy migration target for 'filterExpression')
          const filterExpr = params.scanFilterExpression || params.queryFilterExpression
          if (filterExpr) result.filterExpression = filterExpr
          if (params.projectionExpression) result.projectionExpression = params.projectionExpression
          // expressionAttributeNames: fall back to queryExpressionAttributeNames (legacy migration target)
          const names = parseJson(
            params.scanExpressionAttributeNames || params.queryExpressionAttributeNames,
            'expressionAttributeNames'
          )
          if (names !== undefined) result.expressionAttributeNames = names
          // expressionAttributeValues: fall back to queryExpressionAttributeValues (legacy migration target)
          const values = parseJson(
            params.scanExpressionAttributeValues || params.queryExpressionAttributeValues,
            'expressionAttributeValues'
          )
          if (values !== undefined) result.expressionAttributeValues = values
          // limit: fall back to queryLimit (legacy migration target for 'limit')
          const lim = params.scanLimit || params.queryLimit
          if (lim) result.limit = Number.parseInt(String(lim), 10)
          const esk = parseJson(params.scanExclusiveStartKey, 'exclusiveStartKey')
          if (esk !== undefined) result.exclusiveStartKey = esk
        }

        if (op === 'update') {
          // key: fall back to getKey (legacy migration target for shared 'key' subblock)
          const key = parseJson(params.updateKey || params.getKey, 'key')
          if (key !== undefined) result.key = key
          if (params.updateExpression) result.updateExpression = params.updateExpression
          // expressionAttributeNames: fall back to queryExpressionAttributeNames (legacy migration target)
          const names = parseJson(
            params.updateExpressionAttributeNames || params.queryExpressionAttributeNames,
            'expressionAttributeNames'
          )
          if (names !== undefined) result.expressionAttributeNames = names
          // expressionAttributeValues: fall back to queryExpressionAttributeValues (legacy migration target)
          const values = parseJson(
            params.updateExpressionAttributeValues || params.queryExpressionAttributeValues,
            'expressionAttributeValues'
          )
          if (values !== undefined) result.expressionAttributeValues = values
          if (params.updateConditionExpression)
            result.conditionExpression = params.updateConditionExpression
        }

        if (op === 'delete') {
          // key: fall back to getKey (legacy migration target for shared 'key' subblock)
          const key = parseJson(params.deleteKey || params.getKey, 'key')
          if (key !== undefined) result.key = key
          // conditionExpression: fall back to updateConditionExpression (legacy migration target for shared 'conditionExpression' subblock)
          const deleteCondExpr =
            params.deleteConditionExpression || params.updateConditionExpression
          if (deleteCondExpr) result.conditionExpression = deleteCondExpr
          // expressionAttributeNames: fall back to queryExpressionAttributeNames (legacy migration target)
          const names = parseJson(
            params.deleteExpressionAttributeNames || params.queryExpressionAttributeNames,
            'expressionAttributeNames'
          )
          if (names !== undefined) result.expressionAttributeNames = names
          // expressionAttributeValues: fall back to queryExpressionAttributeValues (legacy migration target)
          const values = parseJson(
            params.deleteExpressionAttributeValues || params.queryExpressionAttributeValues,
            'expressionAttributeValues'
          )
          if (values !== undefined) result.expressionAttributeValues = values
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
    introspectTableName: {
      type: 'string',
      description: 'Optional table name for introspect operation',
    },
    getKey: { type: 'json', description: 'Primary key for get operation' },
    updateKey: { type: 'json', description: 'Primary key for update operation' },
    deleteKey: { type: 'json', description: 'Primary key for delete operation' },
    item: { type: 'json', description: 'Item to put into the table' },
    keyConditionExpression: { type: 'string', description: 'Key condition for query operations' },
    updateExpression: { type: 'string', description: 'Update expression for update operations' },
    queryFilterExpression: { type: 'string', description: 'Filter expression for query' },
    scanFilterExpression: { type: 'string', description: 'Filter expression for scan' },
    projectionExpression: { type: 'string', description: 'Attributes to retrieve in scan' },
    queryExpressionAttributeNames: {
      type: 'json',
      description: 'Attribute name mappings for query',
    },
    scanExpressionAttributeNames: { type: 'json', description: 'Attribute name mappings for scan' },
    updateExpressionAttributeNames: {
      type: 'json',
      description: 'Attribute name mappings for update',
    },
    putExpressionAttributeNames: { type: 'json', description: 'Attribute name mappings for put' },
    deleteExpressionAttributeNames: {
      type: 'json',
      description: 'Attribute name mappings for delete',
    },
    queryExpressionAttributeValues: {
      type: 'json',
      description: 'Expression attribute values for query',
    },
    scanExpressionAttributeValues: {
      type: 'json',
      description: 'Expression attribute values for scan',
    },
    updateExpressionAttributeValues: {
      type: 'json',
      description: 'Expression attribute values for update',
    },
    putExpressionAttributeValues: {
      type: 'json',
      description: 'Expression attribute values for put',
    },
    deleteExpressionAttributeValues: {
      type: 'json',
      description: 'Expression attribute values for delete',
    },
    indexName: { type: 'string', description: 'Secondary index name for query' },
    queryLimit: { type: 'number', description: 'Maximum items to return for query' },
    scanLimit: { type: 'number', description: 'Maximum items to return for scan' },
    putConditionExpression: { type: 'string', description: 'Condition for put operation' },
    updateConditionExpression: { type: 'string', description: 'Condition for update operation' },
    deleteConditionExpression: { type: 'string', description: 'Condition for delete operation' },
    consistentRead: { type: 'string', description: 'Use strongly consistent read' },
    queryExclusiveStartKey: { type: 'json', description: 'Pagination token for query' },
    scanExclusiveStartKey: { type: 'json', description: 'Pagination token for scan' },
    scanIndexForward: {
      type: 'string',
      description: 'Sort order for query: true for ascending, false for descending',
    },
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
    lastEvaluatedKey: {
      type: 'json',
      description:
        'Pagination token from query/scan — pass as exclusiveStartKey to fetch the next page',
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
