import { DescribeTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { DynamoDBConnectionConfig, DynamoDBTableSchema } from '@/tools/dynamodb/types'

export function createDynamoDBClient(config: DynamoDBConnectionConfig): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  })
}

export async function getItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, unknown>,
  consistentRead?: boolean
): Promise<{ item: Record<string, unknown> | null }> {
  const command = new GetCommand({
    TableName: tableName,
    Key: key,
    ConsistentRead: consistentRead,
  })

  const response = await client.send(command)
  return {
    item: (response.Item as Record<string, unknown>) || null,
  }
}

export async function putItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  item: Record<string, unknown>
): Promise<{ success: boolean }> {
  const command = new PutCommand({
    TableName: tableName,
    Item: item,
  })

  await client.send(command)
  return { success: true }
}

export async function queryItems(
  client: DynamoDBDocumentClient,
  tableName: string,
  keyConditionExpression: string,
  options?: {
    filterExpression?: string
    expressionAttributeNames?: Record<string, string>
    expressionAttributeValues?: Record<string, unknown>
    indexName?: string
    limit?: number
  }
): Promise<{ items: Record<string, unknown>[]; count: number }> {
  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ...(options?.filterExpression && { FilterExpression: options.filterExpression }),
    ...(options?.expressionAttributeNames && {
      ExpressionAttributeNames: options.expressionAttributeNames,
    }),
    ...(options?.expressionAttributeValues && {
      ExpressionAttributeValues: options.expressionAttributeValues,
    }),
    ...(options?.indexName && { IndexName: options.indexName }),
    ...(options?.limit && { Limit: options.limit }),
  })

  const response = await client.send(command)
  return {
    items: (response.Items as Record<string, unknown>[]) || [],
    count: response.Count || 0,
  }
}

export async function scanItems(
  client: DynamoDBDocumentClient,
  tableName: string,
  options?: {
    filterExpression?: string
    projectionExpression?: string
    expressionAttributeNames?: Record<string, string>
    expressionAttributeValues?: Record<string, unknown>
    limit?: number
  }
): Promise<{ items: Record<string, unknown>[]; count: number }> {
  const command = new ScanCommand({
    TableName: tableName,
    ...(options?.filterExpression && { FilterExpression: options.filterExpression }),
    ...(options?.projectionExpression && { ProjectionExpression: options.projectionExpression }),
    ...(options?.expressionAttributeNames && {
      ExpressionAttributeNames: options.expressionAttributeNames,
    }),
    ...(options?.expressionAttributeValues && {
      ExpressionAttributeValues: options.expressionAttributeValues,
    }),
    ...(options?.limit && { Limit: options.limit }),
  })

  const response = await client.send(command)
  return {
    items: (response.Items as Record<string, unknown>[]) || [],
    count: response.Count || 0,
  }
}

export async function updateItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, unknown>,
  updateExpression: string,
  options?: {
    expressionAttributeNames?: Record<string, string>
    expressionAttributeValues?: Record<string, unknown>
    conditionExpression?: string
  }
): Promise<{ attributes: Record<string, unknown> | null }> {
  const command = new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ...(options?.expressionAttributeNames && {
      ExpressionAttributeNames: options.expressionAttributeNames,
    }),
    ...(options?.expressionAttributeValues && {
      ExpressionAttributeValues: options.expressionAttributeValues,
    }),
    ...(options?.conditionExpression && { ConditionExpression: options.conditionExpression }),
    ReturnValues: 'ALL_NEW',
  })

  const response = await client.send(command)
  return {
    attributes: (response.Attributes as Record<string, unknown>) || null,
  }
}

export async function deleteItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, unknown>,
  conditionExpression?: string
): Promise<{ success: boolean }> {
  const command = new DeleteCommand({
    TableName: tableName,
    Key: key,
    ...(conditionExpression && { ConditionExpression: conditionExpression }),
  })

  await client.send(command)
  return { success: true }
}

/**
 * Creates a raw DynamoDB client for operations that don't require DocumentClient
 */
export function createRawDynamoDBClient(config: DynamoDBConnectionConfig): DynamoDBClient {
  return new DynamoDBClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/**
 * Lists all DynamoDB tables in the configured region
 */
export async function listTables(client: DynamoDBClient): Promise<{ tables: string[] }> {
  const tables: string[] = []
  let exclusiveStartTableName: string | undefined

  do {
    const command = new ListTablesCommand({
      ExclusiveStartTableName: exclusiveStartTableName,
    })

    const response = await client.send(command)
    if (response.TableNames) {
      tables.push(...response.TableNames)
    }
    exclusiveStartTableName = response.LastEvaluatedTableName
  } while (exclusiveStartTableName)

  return { tables }
}

/**
 * Describes a specific DynamoDB table and returns its schema information
 */
export async function describeTable(
  client: DynamoDBClient,
  tableName: string
): Promise<{ tableDetails: DynamoDBTableSchema }> {
  const command = new DescribeTableCommand({
    TableName: tableName,
  })

  const response = await client.send(command)
  const table = response.Table

  if (!table) {
    throw new Error(`Table '${tableName}' not found`)
  }

  const tableDetails: DynamoDBTableSchema = {
    tableName: table.TableName || tableName,
    tableStatus: table.TableStatus || 'UNKNOWN',
    keySchema:
      table.KeySchema?.map((key) => ({
        attributeName: key.AttributeName || '',
        keyType: (key.KeyType as 'HASH' | 'RANGE') || 'HASH',
      })) || [],
    attributeDefinitions:
      table.AttributeDefinitions?.map((attr) => ({
        attributeName: attr.AttributeName || '',
        attributeType: (attr.AttributeType as 'S' | 'N' | 'B') || 'S',
      })) || [],
    globalSecondaryIndexes:
      table.GlobalSecondaryIndexes?.map((gsi) => ({
        indexName: gsi.IndexName || '',
        keySchema:
          gsi.KeySchema?.map((key) => ({
            attributeName: key.AttributeName || '',
            keyType: (key.KeyType as 'HASH' | 'RANGE') || 'HASH',
          })) || [],
        projectionType: gsi.Projection?.ProjectionType || 'ALL',
        indexStatus: gsi.IndexStatus || 'UNKNOWN',
      })) || [],
    localSecondaryIndexes:
      table.LocalSecondaryIndexes?.map((lsi) => ({
        indexName: lsi.IndexName || '',
        keySchema:
          lsi.KeySchema?.map((key) => ({
            attributeName: key.AttributeName || '',
            keyType: (key.KeyType as 'HASH' | 'RANGE') || 'HASH',
          })) || [],
        projectionType: lsi.Projection?.ProjectionType || 'ALL',
        indexStatus: 'ACTIVE',
      })) || [],
    itemCount: Number(table.ItemCount) || 0,
    tableSizeBytes: Number(table.TableSizeBytes) || 0,
    billingMode: table.BillingModeSummary?.BillingMode || 'PROVISIONED',
  }

  return { tableDetails }
}
