import type { AwsDynamodbDeleteBody } from '@/lib/api/contracts/tools/aws/dynamodb-delete'
import type { AwsDynamodbGetBody } from '@/lib/api/contracts/tools/aws/dynamodb-get'
import type { AwsDynamodbIntrospectBody } from '@/lib/api/contracts/tools/aws/dynamodb-introspect'
import type { AwsDynamodbPutBody } from '@/lib/api/contracts/tools/aws/dynamodb-put'
import type { AwsDynamodbQueryBody } from '@/lib/api/contracts/tools/aws/dynamodb-query'
import type { AwsDynamodbScanBody } from '@/lib/api/contracts/tools/aws/dynamodb-scan'
import type { AwsDynamodbUpdateBody } from '@/lib/api/contracts/tools/aws/dynamodb-update'
import {
  createDynamoDBClient,
  createRawDynamoDBClient,
  deleteItem,
  describeTable,
  getItem,
  listTables,
  putItem,
  queryItems,
  scanItems,
  updateItem,
} from '@/lib/internal/dynamodb/client'

export async function executeDynamodbGet(input: AwsDynamodbGetBody, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const client = createDynamoDBClient(input)
  try {
    const result = await getItem(client, input.tableName, input.key, input.consistentRead, signal)
    signal?.throwIfAborted()
    return {
      message: result.item ? 'Item retrieved successfully' : 'Item not found',
      item: result.item,
    }
  } finally {
    client.destroy()
  }
}

export async function executeDynamodbPut(input: AwsDynamodbPutBody, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const client = createDynamoDBClient(input)
  try {
    await putItem(
      client,
      input.tableName,
      input.item,
      {
        conditionExpression: input.conditionExpression,
        expressionAttributeNames: input.expressionAttributeNames,
        expressionAttributeValues: input.expressionAttributeValues,
      },
      signal
    )
    signal?.throwIfAborted()
    return { message: 'Item created successfully', item: input.item }
  } finally {
    client.destroy()
  }
}

export async function executeDynamodbQuery(input: AwsDynamodbQueryBody, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const client = createDynamoDBClient(input)
  try {
    const result = await queryItems(
      client,
      input.tableName,
      input.keyConditionExpression,
      {
        filterExpression: input.filterExpression,
        expressionAttributeNames: input.expressionAttributeNames,
        expressionAttributeValues: input.expressionAttributeValues,
        indexName: input.indexName,
        limit: input.limit,
        exclusiveStartKey: input.exclusiveStartKey,
        scanIndexForward: input.scanIndexForward,
      },
      signal
    )
    signal?.throwIfAborted()
    return {
      message: `Query returned ${result.count} items`,
      items: result.items,
      count: result.count,
      ...(result.lastEvaluatedKey && { lastEvaluatedKey: result.lastEvaluatedKey }),
    }
  } finally {
    client.destroy()
  }
}

export async function executeDynamodbScan(input: AwsDynamodbScanBody, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const client = createDynamoDBClient(input)
  try {
    const result = await scanItems(
      client,
      input.tableName,
      {
        filterExpression: input.filterExpression,
        projectionExpression: input.projectionExpression,
        expressionAttributeNames: input.expressionAttributeNames,
        expressionAttributeValues: input.expressionAttributeValues,
        limit: input.limit,
        exclusiveStartKey: input.exclusiveStartKey,
      },
      signal
    )
    signal?.throwIfAborted()
    return {
      message: `Scan returned ${result.count} items`,
      items: result.items,
      count: result.count,
      ...(result.lastEvaluatedKey && { lastEvaluatedKey: result.lastEvaluatedKey }),
    }
  } finally {
    client.destroy()
  }
}

export async function executeDynamodbUpdate(input: AwsDynamodbUpdateBody, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const client = createDynamoDBClient(input)
  try {
    const result = await updateItem(
      client,
      input.tableName,
      input.key,
      input.updateExpression,
      {
        expressionAttributeNames: input.expressionAttributeNames,
        expressionAttributeValues: input.expressionAttributeValues,
        conditionExpression: input.conditionExpression,
      },
      signal
    )
    signal?.throwIfAborted()
    return { message: 'Item updated successfully', item: result.attributes }
  } finally {
    client.destroy()
  }
}

export async function executeDynamodbDelete(input: AwsDynamodbDeleteBody, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const client = createDynamoDBClient(input)
  try {
    await deleteItem(
      client,
      input.tableName,
      input.key,
      {
        conditionExpression: input.conditionExpression,
        expressionAttributeNames: input.expressionAttributeNames,
        expressionAttributeValues: input.expressionAttributeValues,
      },
      signal
    )
    signal?.throwIfAborted()
    return { message: 'Item deleted successfully' }
  } finally {
    client.destroy()
  }
}

export async function executeDynamodbIntrospect(
  input: AwsDynamodbIntrospectBody,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const client = createRawDynamoDBClient(input)
  try {
    const { tables } = await listTables(client, signal)

    if (input.tableName) {
      const { tableDetails } = await describeTable(client, input.tableName, signal)
      signal?.throwIfAborted()
      return {
        message: `Table '${input.tableName}' described successfully.`,
        tables,
        tableDetails,
      }
    }

    signal?.throwIfAborted()
    return {
      message: `Found ${tables.length} table(s) in region '${input.region}'.`,
      tables,
    }
  } finally {
    client.destroy()
  }
}
