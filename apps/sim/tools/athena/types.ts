import type { ToolResponse } from '@/tools/types'

interface AthenaConnectionConfig {
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
}

export interface AthenaStartQueryParams extends AthenaConnectionConfig {
  queryString: string
  database?: string
  catalog?: string
  outputLocation?: string
  workGroup?: string
}

export interface AthenaStartQueryResponse extends ToolResponse {
  output: {
    queryExecutionId: string
  }
}

export interface AthenaGetQueryExecutionParams extends AthenaConnectionConfig {
  queryExecutionId: string
}

export interface AthenaGetQueryExecutionResponse extends ToolResponse {
  output: {
    queryExecutionId: string
    query: string
    state: string
    stateChangeReason: string | null
    statementType: string | null
    database: string | null
    catalog: string | null
    workGroup: string | null
    submissionDateTime: number | null
    completionDateTime: number | null
    dataScannedInBytes: number | null
    engineExecutionTimeInMillis: number | null
    queryPlanningTimeInMillis: number | null
    queryQueueTimeInMillis: number | null
    totalExecutionTimeInMillis: number | null
    outputLocation: string | null
  }
}

export interface AthenaGetQueryResultsParams extends AthenaConnectionConfig {
  queryExecutionId: string
  maxResults?: number
  nextToken?: string
}

export interface AthenaGetQueryResultsResponse extends ToolResponse {
  output: {
    columns: { name: string; type: string }[]
    rows: Record<string, string>[]
    nextToken: string | null
    updateCount: number | null
  }
}

export interface AthenaStopQueryParams extends AthenaConnectionConfig {
  queryExecutionId: string
}

export interface AthenaStopQueryResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface AthenaListQueryExecutionsParams extends AthenaConnectionConfig {
  workGroup?: string
  maxResults?: number
  nextToken?: string
}

export interface AthenaListQueryExecutionsResponse extends ToolResponse {
  output: {
    queryExecutionIds: string[]
    nextToken: string | null
  }
}

export interface AthenaCreateNamedQueryParams extends AthenaConnectionConfig {
  name: string
  database: string
  queryString: string
  description?: string
  workGroup?: string
}

export interface AthenaCreateNamedQueryResponse extends ToolResponse {
  output: {
    namedQueryId: string
  }
}

export interface AthenaGetNamedQueryParams extends AthenaConnectionConfig {
  namedQueryId: string
}

export interface AthenaGetNamedQueryResponse extends ToolResponse {
  output: {
    namedQueryId: string
    name: string
    description: string | null
    database: string
    queryString: string
    workGroup: string | null
  }
}

export interface AthenaListNamedQueriesParams extends AthenaConnectionConfig {
  workGroup?: string
  maxResults?: number
  nextToken?: string
}

export interface AthenaListNamedQueriesResponse extends ToolResponse {
  output: {
    namedQueryIds: string[]
    nextToken: string | null
  }
}

export interface AthenaDeleteNamedQueryParams extends AthenaConnectionConfig {
  namedQueryId: string
}

export interface AthenaDeleteNamedQueryResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface AthenaBatchGetQueryExecutionParams extends AthenaConnectionConfig {
  queryExecutionIds: string
}

export interface AthenaQueryExecutionSummary {
  queryExecutionId: string
  query: string | null
  state: string | null
  stateChangeReason: string | null
  statementType: string | null
  database: string | null
  catalog: string | null
  workGroup: string | null
  submissionDateTime: number | null
  completionDateTime: number | null
  dataScannedInBytes: number | null
  engineExecutionTimeInMillis: number | null
  queryPlanningTimeInMillis: number | null
  queryQueueTimeInMillis: number | null
  totalExecutionTimeInMillis: number | null
  outputLocation: string | null
}

export interface AthenaUnprocessedQueryExecutionId {
  queryExecutionId: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface AthenaBatchGetQueryExecutionResponse extends ToolResponse {
  output: {
    queryExecutions: AthenaQueryExecutionSummary[]
    unprocessedQueryExecutionIds: AthenaUnprocessedQueryExecutionId[]
  }
}

export interface AthenaListDatabasesParams extends AthenaConnectionConfig {
  catalogName: string
  workGroup?: string
  maxResults?: number
  nextToken?: string
}

export interface AthenaDatabase {
  name: string
  description: string | null
}

export interface AthenaListDatabasesResponse extends ToolResponse {
  output: {
    databases: AthenaDatabase[]
    nextToken: string | null
  }
}

export interface AthenaListTableMetadataParams extends AthenaConnectionConfig {
  catalogName: string
  databaseName: string
  expression?: string
  workGroup?: string
  maxResults?: number
  nextToken?: string
}

export interface AthenaColumn {
  name: string
  type: string | null
  comment: string | null
}

export interface AthenaTableMetadata {
  name: string
  tableType: string | null
  createTime: number | null
  lastAccessTime: number | null
  columns: AthenaColumn[]
  partitionKeys: AthenaColumn[]
}

export interface AthenaListTableMetadataResponse extends ToolResponse {
  output: {
    tables: AthenaTableMetadata[]
    nextToken: string | null
  }
}
