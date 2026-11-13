import { DescribeTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  NumberValue,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { isRecordLike } from '@sim/utils/object'
import { awsClientConfig } from '@/lib/internal/aws/credentials'
import type { DynamoDBConnectionConfig, DynamoDBTableSchema } from '@/tools/dynamodb/types'

type DynamoDBReturnValues = 'NONE' | 'ALL_OLD' | 'UPDATED_OLD' | 'ALL_NEW' | 'UPDATED_NEW'

/**
 * Keeps any DynamoDB number a JS number cannot hold exactly (integers beyond
 * `Number.MAX_SAFE_INTEGER`, high-precision decimals, non-finite values) as a `NumberValue`
 * with the exact string, so pagination cursors can round-trip it. The SDK default would turn
 * large integers into a `BigInt` that the JSON response cannot serialize.
 */
function unwrapNumber(value: string): number | NumberValue {
  const parsed = Number(value)
  const exact = Number.isFinite(parsed) && String(parsed) === value
  if (exact && (!Number.isInteger(parsed) || Number.isSafeInteger(parsed))) return parsed
  return NumberValue.from(value)
}

/**
 * Item output for a number kept as a `NumberValue`: the exact string for integers beyond
 * `Number.MAX_SAFE_INTEGER` and non-finite values, otherwise the nearest JS number.
 */
function numberValueToJson(value: NumberValue): number | string {
  const exact = value.toString()
  const parsed = Number(exact)
  if (!Number.isFinite(parsed) || (Number.isInteger(parsed) && !Number.isSafeInteger(parsed))) {
    return exact
  }
  return parsed
}

/**
 * Converts unmarshalled DynamoDB values into JSON-serializable shapes: string, number and
 * binary sets become arrays, binary values become base64 strings, and numbers kept as a
 * `NumberValue` become a JS number or, when one cannot hold them, their exact string. Without this a set serializes as `{}` and a binary
 * value as an object of byte indexes.
 */
function toJsonSafe(value: unknown): unknown {
  if (value instanceof NumberValue) return numberValueToJson(value)
  if (value instanceof Set) return Array.from(value, toJsonSafe)
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  if (Array.isArray(value)) return value.map(toJsonSafe)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJsonSafe(entry)]))
  }
  return value
}

function toJsonSafeRecord(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return value ? (toJsonSafe(value) as Record<string, unknown>) : undefined
}

/**
 * Encodes a `LastEvaluatedKey` so it can be passed back as `exclusiveStartKey`. Key
 * attributes are always scalar (S, N or B), so strings and exact numbers stay as-is while a
 * number a JS number cannot hold exactly becomes `{ N }` and a binary key becomes `{ B }` (base64):
 * plain strings would otherwise be sent back as S and fail the key type check.
 */
function toCursor(key: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!key) return undefined
  return Object.fromEntries(
    Object.entries(key).map(([name, value]) => {
      if (value instanceof NumberValue) return [name, { N: value.toString() }]
      if (value instanceof Uint8Array) return [name, { B: toJsonSafe(value) }]
      return [name, value]
    })
  )
}

const DYNAMODB_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/

/** Restores the `{ N }` and `{ B }` cursor values written by {@link toCursor}. */
function fromCursor(key: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(key).map(([name, value]) => {
      if (isRecordLike(value) && Object.keys(value).length === 1) {
        if (typeof value.N === 'string' && DYNAMODB_NUMBER.test(value.N)) {
          return [name, NumberValue.from(value.N)]
        }
        if (typeof value.B === 'string') {
          return [name, new Uint8Array(Buffer.from(value.B, 'base64'))]
        }
      }
      return [name, value]
    })
  )
}

export function createDynamoDBClient(config: DynamoDBConnectionConfig): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    ...awsClientConfig(config.region, config.accessKeyId, config.secretAccessKey),
  })

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
    unmarshallOptions: {
      wrapNumbers: unwrapNumber,
    },
  })
}

export async function getItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, unknown>,
  consistentRead?: boolean,
  signal?: AbortSignal,
  options?: {
    projectionExpression?: string
    expressionAttributeNames?: Record<string, string>
  }
): Promise<{ item: Record<string, unknown> | null }> {
  const command = new GetCommand({
    TableName: tableName,
    Key: key,
    ConsistentRead: consistentRead,
    ...(options?.projectionExpression && { ProjectionExpression: options.projectionExpression }),
    ...(options?.expressionAttributeNames && {
      ExpressionAttributeNames: options.expressionAttributeNames,
    }),
  })

  const response = await client.send(command, { abortSignal: signal })
  return {
    item: toJsonSafeRecord(response.Item) ?? null,
  }
}

export async function putItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  item: Record<string, unknown>,
  options?: {
    conditionExpression?: string
    expressionAttributeNames?: Record<string, string>
    expressionAttributeValues?: Record<string, unknown>
    returnValues?: 'NONE' | 'ALL_OLD'
  },
  signal?: AbortSignal
): Promise<{ success: boolean; attributes: Record<string, unknown> | null }> {
  const command = new PutCommand({
    TableName: tableName,
    Item: item,
    ...(options?.conditionExpression && { ConditionExpression: options.conditionExpression }),
    ...(options?.expressionAttributeNames && {
      ExpressionAttributeNames: options.expressionAttributeNames,
    }),
    ...(options?.expressionAttributeValues && {
      ExpressionAttributeValues: options.expressionAttributeValues,
    }),
    ...(options?.returnValues && { ReturnValues: options.returnValues }),
  })

  const response = await client.send(command, { abortSignal: signal })
  return { success: true, attributes: toJsonSafeRecord(response.Attributes) ?? null }
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
    exclusiveStartKey?: Record<string, unknown>
    scanIndexForward?: boolean
    projectionExpression?: string
    consistentRead?: boolean
  },
  signal?: AbortSignal
): Promise<{
  items: Record<string, unknown>[]
  count: number
  scannedCount: number | null
  lastEvaluatedKey?: Record<string, unknown>
}> {
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
    ...(options?.exclusiveStartKey && { ExclusiveStartKey: fromCursor(options.exclusiveStartKey) }),
    ...(options?.scanIndexForward !== undefined && { ScanIndexForward: options.scanIndexForward }),
    ...(options?.projectionExpression && { ProjectionExpression: options.projectionExpression }),
    ...(options?.consistentRead !== undefined && { ConsistentRead: options.consistentRead }),
  })

  const response = await client.send(command, { abortSignal: signal })
  return {
    items: (response.Items ?? []).map((item) => toJsonSafeRecord(item) ?? {}),
    count: response.Count || 0,
    scannedCount: response.ScannedCount ?? null,
    lastEvaluatedKey: toCursor(response.LastEvaluatedKey),
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
    exclusiveStartKey?: Record<string, unknown>
    indexName?: string
    consistentRead?: boolean
    segment?: number
    totalSegments?: number
  },
  signal?: AbortSignal
): Promise<{
  items: Record<string, unknown>[]
  count: number
  scannedCount: number | null
  lastEvaluatedKey?: Record<string, unknown>
}> {
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
    ...(options?.exclusiveStartKey && { ExclusiveStartKey: fromCursor(options.exclusiveStartKey) }),
    ...(options?.indexName && { IndexName: options.indexName }),
    ...(options?.consistentRead !== undefined && { ConsistentRead: options.consistentRead }),
    ...(options?.segment !== undefined && { Segment: options.segment }),
    ...(options?.totalSegments !== undefined && { TotalSegments: options.totalSegments }),
  })

  const response = await client.send(command, { abortSignal: signal })
  return {
    items: (response.Items ?? []).map((item) => toJsonSafeRecord(item) ?? {}),
    count: response.Count || 0,
    scannedCount: response.ScannedCount ?? null,
    lastEvaluatedKey: toCursor(response.LastEvaluatedKey),
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
    returnValues?: DynamoDBReturnValues
  },
  signal?: AbortSignal
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
    ReturnValues: options?.returnValues ?? 'ALL_NEW',
  })

  const response = await client.send(command, { abortSignal: signal })
  return {
    attributes: toJsonSafeRecord(response.Attributes) ?? null,
  }
}

export async function deleteItem(
  client: DynamoDBDocumentClient,
  tableName: string,
  key: Record<string, unknown>,
  options?: {
    conditionExpression?: string
    expressionAttributeNames?: Record<string, string>
    expressionAttributeValues?: Record<string, unknown>
    returnValues?: 'NONE' | 'ALL_OLD'
  },
  signal?: AbortSignal
): Promise<{ success: boolean; attributes: Record<string, unknown> | null }> {
  const command = new DeleteCommand({
    TableName: tableName,
    Key: key,
    ...(options?.conditionExpression && { ConditionExpression: options.conditionExpression }),
    ...(options?.expressionAttributeNames && {
      ExpressionAttributeNames: options.expressionAttributeNames,
    }),
    ...(options?.expressionAttributeValues && {
      ExpressionAttributeValues: options.expressionAttributeValues,
    }),
    ...(options?.returnValues && { ReturnValues: options.returnValues }),
  })

  const response = await client.send(command, { abortSignal: signal })
  return { success: true, attributes: toJsonSafeRecord(response.Attributes) ?? null }
}

/**
 * Creates a raw DynamoDB client for operations that don't require DocumentClient
 */
export function createRawDynamoDBClient(config: DynamoDBConnectionConfig): DynamoDBClient {
  return new DynamoDBClient({
    ...awsClientConfig(config.region, config.accessKeyId, config.secretAccessKey),
  })
}

/**
 * Lists all DynamoDB tables in the configured region
 */
export async function listTables(
  client: DynamoDBClient,
  signal?: AbortSignal
): Promise<{ tables: string[] }> {
  const tables: string[] = []
  let exclusiveStartTableName: string | undefined

  do {
    const command = new ListTablesCommand({
      ExclusiveStartTableName: exclusiveStartTableName,
    })

    const response = await client.send(command, { abortSignal: signal })
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
  tableName: string,
  signal?: AbortSignal
): Promise<{ tableDetails: DynamoDBTableSchema }> {
  const command = new DescribeTableCommand({
    TableName: tableName,
  })

  const response = await client.send(command, { abortSignal: signal })
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
    tableArn: table.TableArn ?? null,
    creationDateTime: table.CreationDateTime?.toISOString() ?? null,
    deletionProtectionEnabled: table.DeletionProtectionEnabled ?? null,
    streamEnabled: table.StreamSpecification?.StreamEnabled ?? null,
    streamViewType: table.StreamSpecification?.StreamViewType ?? null,
    latestStreamArn: table.LatestStreamArn ?? null,
  }

  return { tableDetails }
}
