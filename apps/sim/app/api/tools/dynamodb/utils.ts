import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { DynamoDBConnectionConfig } from '@/tools/dynamodb/types'

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
