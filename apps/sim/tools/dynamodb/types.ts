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
}

export interface DynamoDBPutParams extends DynamoDBConnectionConfig {
  tableName: string
  item: Record<string, unknown>
}

export interface DynamoDBQueryParams extends DynamoDBConnectionConfig {
  tableName: string
  keyConditionExpression: string
  filterExpression?: string
  expressionAttributeNames?: Record<string, string>
  expressionAttributeValues?: Record<string, unknown>
  indexName?: string
  limit?: number
}

export interface DynamoDBScanParams extends DynamoDBConnectionConfig {
  tableName: string
  filterExpression?: string
  projectionExpression?: string
  expressionAttributeNames?: Record<string, string>
  expressionAttributeValues?: Record<string, unknown>
  limit?: number
}

export interface DynamoDBUpdateParams extends DynamoDBConnectionConfig {
  tableName: string
  key: Record<string, unknown>
  updateExpression: string
  expressionAttributeNames?: Record<string, string>
  expressionAttributeValues?: Record<string, unknown>
  conditionExpression?: string
}

export interface DynamoDBDeleteParams extends DynamoDBConnectionConfig {
  tableName: string
  key: Record<string, unknown>
  conditionExpression?: string
}

export interface DynamoDBBaseResponse extends ToolResponse {
  output: {
    message: string
    item?: Record<string, unknown>
    items?: Record<string, unknown>[]
    count?: number
  }
  error?: string
}

export interface DynamoDBGetResponse extends DynamoDBBaseResponse {}
export interface DynamoDBPutResponse extends DynamoDBBaseResponse {}
export interface DynamoDBQueryResponse extends DynamoDBBaseResponse {}
export interface DynamoDBScanResponse extends DynamoDBBaseResponse {}
export interface DynamoDBUpdateResponse extends DynamoDBBaseResponse {}
export interface DynamoDBDeleteResponse extends DynamoDBBaseResponse {}
export interface DynamoDBResponse extends DynamoDBBaseResponse {}

export interface DynamoDBIntrospectParams extends DynamoDBConnectionConfig {
  tableName?: string
}

export interface DynamoDBKeySchema {
  attributeName: string
  keyType: 'HASH' | 'RANGE'
}

export interface DynamoDBAttributeDefinition {
  attributeName: string
  attributeType: 'S' | 'N' | 'B'
}

export interface DynamoDBGSI {
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
}

export interface DynamoDBIntrospectResponse extends ToolResponse {
  output: {
    message: string
    tables: string[]
    tableDetails?: DynamoDBTableSchema
  }
  error?: string
}
