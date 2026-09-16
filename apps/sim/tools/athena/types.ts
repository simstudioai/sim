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
  executionParameters?: string[] | string
  resultReuseEnabled?: boolean
  resultReuseMaxAgeInMinutes?: number
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
  parameters: Record<string, string>
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
  parameters: Record<string, string>
}

export interface AthenaListTableMetadataResponse extends ToolResponse {
  output: {
    tables: AthenaTableMetadata[]
    nextToken: string | null
  }
}

export interface AthenaNamedQuery {
  namedQueryId: string
  name: string
  description: string | null
  database: string
  queryString: string
  workGroup: string | null
}

export interface AthenaPreparedStatement {
  statementName: string
  queryStatement: string
  workGroupName: string | null
  description: string | null
  lastModifiedTime: number | null
}

export interface AthenaEngineVersion {
  selectedEngineVersion: string | null
  effectiveEngineVersion: string | null
}

export interface AthenaGetQueryRuntimeStatisticsParams extends AthenaConnectionConfig {
  queryExecutionId: string
}

export interface AthenaGetQueryRuntimeStatisticsResponse extends ToolResponse {
  output: {
    queryExecutionId: string
    timeline: {
      queryQueueTimeInMillis: number | null
      servicePreProcessingTimeInMillis: number | null
      queryPlanningTimeInMillis: number | null
      engineExecutionTimeInMillis: number | null
      serviceProcessingTimeInMillis: number | null
      totalExecutionTimeInMillis: number | null
    }
    rowStatistics: {
      inputRows: number | null
      inputBytes: number | null
      outputRows: number | null
      outputBytes: number | null
    }
    outputStage: {
      stageId: number | null
      state: string | null
      inputRows: number | null
      inputBytes: number | null
      outputRows: number | null
      outputBytes: number | null
      executionTime: number | null
      subStageCount: number
    } | null
  }
}

export interface AthenaBatchGetNamedQueryParams extends AthenaConnectionConfig {
  namedQueryIds: string
}

export interface AthenaBatchGetNamedQueryResponse extends ToolResponse {
  output: {
    namedQueries: AthenaNamedQuery[]
    unprocessedNamedQueryIds: {
      namedQueryId: string | null
      errorCode: string | null
      errorMessage: string | null
    }[]
  }
}

export interface AthenaUpdateNamedQueryParams extends AthenaConnectionConfig {
  namedQueryId: string
  name: string
  queryString: string
  description?: string
}

export interface AthenaUpdateNamedQueryResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface AthenaGetDatabaseParams extends AthenaConnectionConfig {
  catalogName: string
  databaseName: string
  workGroup?: string
}

export interface AthenaGetDatabaseResponse extends ToolResponse {
  output: {
    name: string
    description: string | null
    parameters: Record<string, string>
  }
}

export interface AthenaGetTableMetadataParams extends AthenaConnectionConfig {
  catalogName: string
  databaseName: string
  tableName: string
  workGroup?: string
}

export interface AthenaGetTableMetadataResponse extends ToolResponse {
  output: {
    name: string
    tableType: string | null
    createTime: number | null
    lastAccessTime: number | null
    columns: AthenaColumn[]
    partitionKeys: AthenaColumn[]
    parameters: Record<string, string>
  }
}

export interface AthenaListDataCatalogsParams extends AthenaConnectionConfig {
  workGroup?: string
  maxResults?: number
  nextToken?: string
}

export interface AthenaListDataCatalogsResponse extends ToolResponse {
  output: {
    dataCatalogs: {
      catalogName: string
      type: string | null
      status: string | null
      connectionType: string | null
      error: string | null
    }[]
    nextToken: string | null
  }
}

export interface AthenaGetDataCatalogParams extends AthenaConnectionConfig {
  name: string
  workGroup?: string
}

export interface AthenaGetDataCatalogResponse extends ToolResponse {
  output: {
    name: string
    type: string
    description: string | null
    status: string | null
    connectionType: string | null
    error: string | null
    parameters: Record<string, string>
  }
}

export interface AthenaListWorkGroupsParams extends AthenaConnectionConfig {
  maxResults?: number
  nextToken?: string
}

export interface AthenaListWorkGroupsResponse extends ToolResponse {
  output: {
    workGroups: {
      name: string
      state: string | null
      description: string | null
      creationTime: number | null
      engineVersion: AthenaEngineVersion | null
      identityCenterApplicationArn: string | null
    }[]
    nextToken: string | null
  }
}

export interface AthenaGetWorkGroupParams extends AthenaConnectionConfig {
  workGroup: string
}

export interface AthenaGetWorkGroupResponse extends ToolResponse {
  output: {
    name: string
    state: string | null
    description: string | null
    creationTime: number | null
    identityCenterApplicationArn: string | null
    engineVersion: AthenaEngineVersion | null
    outputLocation: string | null
    encryptionOption: string | null
    kmsKey: string | null
    expectedBucketOwner: string | null
    managedQueryResultsEnabled: boolean | null
    enforceWorkGroupConfiguration: boolean | null
    publishCloudWatchMetricsEnabled: boolean | null
    bytesScannedCutoffPerQuery: number | null
    requesterPaysEnabled: boolean | null
    enableMinimumEncryptionConfiguration: boolean | null
    executionRole: string | null
  }
}

export interface AthenaCreatePreparedStatementParams extends AthenaConnectionConfig {
  statementName: string
  workGroup: string
  queryStatement: string
  description?: string
}

export interface AthenaCreatePreparedStatementResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface AthenaGetPreparedStatementParams extends AthenaConnectionConfig {
  statementName: string
  workGroup: string
}

export interface AthenaGetPreparedStatementResponse extends ToolResponse {
  output: {
    statementName: string
    queryStatement: string
    workGroupName: string | null
    description: string | null
    lastModifiedTime: number | null
  }
}

export interface AthenaUpdatePreparedStatementParams extends AthenaConnectionConfig {
  statementName: string
  workGroup: string
  queryStatement: string
  description?: string
}

export interface AthenaUpdatePreparedStatementResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface AthenaDeletePreparedStatementParams extends AthenaConnectionConfig {
  statementName: string
  workGroup: string
}

export interface AthenaDeletePreparedStatementResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface AthenaListPreparedStatementsParams extends AthenaConnectionConfig {
  workGroup: string
  maxResults?: number
  nextToken?: string
}

export interface AthenaListPreparedStatementsResponse extends ToolResponse {
  output: {
    preparedStatements: { statementName: string; lastModifiedTime: number | null }[]
    nextToken: string | null
  }
}

export interface AthenaBatchGetPreparedStatementParams extends AthenaConnectionConfig {
  preparedStatementNames: string
  workGroup: string
}

export interface AthenaBatchGetPreparedStatementResponse extends ToolResponse {
  output: {
    preparedStatements: AthenaPreparedStatement[]
    unprocessedPreparedStatementNames: {
      statementName: string | null
      errorCode: string | null
      errorMessage: string | null
    }[]
  }
}
