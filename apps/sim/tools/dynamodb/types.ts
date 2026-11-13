import type { ToolResponse } from '@/tools/types'

export interface DynamoDBConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface DynamoDBGetParams extends DynamoDBConnectionConfig {
  tableName: string
  key: Record<string, unknown>
  consistentRead?: boolean
  projectionExpression?: string
  expressionAttributeNames?: Record<string, string>
}

export interface DynamoDBPutParams extends DynamoDBConnectionConfig {
  tableName: string
  item: Record<string, unknown>
  conditionExpression?: string
  expressionAttributeNames?: Record<string, string>
  expressionAttributeValues?: Record<string, unknown>
  returnValues?: 'NONE' | 'ALL_OLD'
}

export interface DynamoDBQueryParams extends DynamoDBConnectionConfig {
  tableName: string
  keyConditionExpression: string
  filterExpression?: string
  expressionAttributeNames?: Record<string, string>
  expressionAttributeValues?: Record<string, unknown>
  indexName?: string
  limit?: number
  exclusiveStartKey?: Record<string, unknown>
  scanIndexForward?: boolean
  projectionExpression?: string
  consistentRead?: boolean
}

export interface DynamoDBScanParams extends DynamoDBConnectionConfig {
  tableName: string
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
}

export interface DynamoDBUpdateParams extends DynamoDBConnectionConfig {
  tableName: string
  key: Record<string, unknown>
  updateExpression: string
  expressionAttributeNames?: Record<string, string>
  expressionAttributeValues?: Record<string, unknown>
  conditionExpression?: string
  returnValues?: 'NONE' | 'ALL_OLD' | 'UPDATED_OLD' | 'ALL_NEW' | 'UPDATED_NEW'
}

export interface DynamoDBDeleteParams extends DynamoDBConnectionConfig {
  tableName: string
  key: Record<string, unknown>
  conditionExpression?: string
  expressionAttributeNames?: Record<string, string>
  expressionAttributeValues?: Record<string, unknown>
  returnValues?: 'NONE' | 'ALL_OLD'
}

interface DynamoDBBaseResponse extends ToolResponse {
  output: {
    message: string
    item?: Record<string, unknown>
    items?: Record<string, unknown>[]
    count?: number
    scannedCount?: number | null
    lastEvaluatedKey?: Record<string, unknown>
    attributes?: Record<string, unknown> | null
  }
}

export type DynamoDBGetResponse = DynamoDBBaseResponse
export type DynamoDBPutResponse = DynamoDBBaseResponse
export type DynamoDBQueryResponse = DynamoDBBaseResponse
export type DynamoDBScanResponse = DynamoDBBaseResponse
export type DynamoDBUpdateResponse = DynamoDBBaseResponse
export type DynamoDBDeleteResponse = DynamoDBBaseResponse
export interface DynamoDBIntrospectParams extends DynamoDBConnectionConfig {
  tableName?: string
}

interface DynamoDBKeySchema {
  attributeName: string
  keyType: 'HASH' | 'RANGE'
}

interface DynamoDBAttributeDefinition {
  attributeName: string
  attributeType: 'S' | 'N' | 'B'
}

interface DynamoDBGSI {
  indexName: string
  keySchema: DynamoDBKeySchema[]
  projectionType: string
  indexStatus: string
}

export interface DynamoDBTableSchema {
  tableName: string
  tableStatus: string
  keySchema: DynamoDBKeySchema[]
  attributeDefinitions: DynamoDBAttributeDefinition[]
  globalSecondaryIndexes: DynamoDBGSI[]
  localSecondaryIndexes: DynamoDBGSI[]
  itemCount: number
  tableSizeBytes: number
  billingMode: string
  tableArn?: string | null
  creationDateTime?: string | null
  deletionProtectionEnabled?: boolean | null
  streamEnabled?: boolean | null
  streamViewType?: string | null
  latestStreamArn?: string | null
}

export interface DynamoDBIntrospectResponse extends ToolResponse {
  output: {
    message: string
    tables: string[]
    tableDetails?: DynamoDBTableSchema
  }
}
