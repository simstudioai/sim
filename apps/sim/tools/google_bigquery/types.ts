import type { ToolResponse } from '@/tools/types'

interface GoogleBigQueryBaseParams {
  accessToken: string
  projectId: string
}

export interface GoogleBigQueryQueryParams extends GoogleBigQueryBaseParams {
  query: string
  useLegacySql?: boolean
  maxResults?: number
  defaultDatasetId?: string
  location?: string
}

export interface GoogleBigQueryListDatasetsParams extends GoogleBigQueryBaseParams {
  maxResults?: number
  pageToken?: string
}

export interface GoogleBigQueryListTablesParams extends GoogleBigQueryBaseParams {
  datasetId: string
  maxResults?: number
  pageToken?: string
}

export interface GoogleBigQueryGetTableParams extends GoogleBigQueryBaseParams {
  datasetId: string
  tableId: string
}

export interface GoogleBigQueryInsertRowsParams extends GoogleBigQueryBaseParams {
  datasetId: string
  tableId: string
  rows: string
  skipInvalidRows?: boolean
  ignoreUnknownValues?: boolean
}

export interface GoogleBigQueryCreateDatasetParams extends GoogleBigQueryBaseParams {
  datasetId: string
  location?: string
  friendlyName?: string
  description?: string
}

export interface GoogleBigQueryDeleteDatasetParams extends GoogleBigQueryBaseParams {
  datasetId: string
  deleteContents?: boolean
}

export interface GoogleBigQueryCreateTableParams extends GoogleBigQueryBaseParams {
  datasetId: string
  tableId: string
  schema: string
  description?: string
  friendlyName?: string
}

export interface GoogleBigQueryDeleteTableParams extends GoogleBigQueryBaseParams {
  datasetId: string
  tableId: string
}

export interface GoogleBigQueryListTableDataParams extends GoogleBigQueryBaseParams {
  datasetId: string
  tableId: string
  maxResults?: number
  pageToken?: string
  startIndex?: string
  selectedFields?: string
}

export interface GoogleBigQueryGetQueryResultsParams extends GoogleBigQueryBaseParams {
  jobId: string
  pageToken?: string
  maxResults?: number
  timeoutMs?: number
  location?: string
  startIndex?: string
}

interface GoogleBigQueryJobReference {
  projectId: string
  jobId: string
  location: string
}

export interface GoogleBigQueryQueryResponse extends ToolResponse {
  output: {
    columns: string[]
    rows: Record<string, unknown>[]
    totalRows: string | null
    jobComplete: boolean
    totalBytesProcessed: string | null
    cacheHit: boolean | null
    jobReference: GoogleBigQueryJobReference | null
    pageToken: string | null
  }
}

export interface GoogleBigQueryListDatasetsResponse extends ToolResponse {
  output: {
    datasets: Array<{
      datasetId: string
      projectId: string
      friendlyName: string | null
      location: string | null
    }>
    nextPageToken: string | null
  }
}

export interface GoogleBigQueryListTablesResponse extends ToolResponse {
  output: {
    tables: Array<{
      tableId: string
      datasetId: string
      projectId: string
      type: string | null
      friendlyName: string | null
      creationTime: string | null
    }>
    totalItems: number | null
    nextPageToken: string | null
  }
}

export interface GoogleBigQueryGetTableResponse extends ToolResponse {
  output: {
    tableId: string
    datasetId: string
    projectId: string
    type: string | null
    description: string | null
    numRows: string | null
    numBytes: string | null
    schema: Array<{
      name: string
      type: string
      mode: string | null
      description: string | null
    }>
    creationTime: string | null
    lastModifiedTime: string | null
    location: string | null
  }
}

export interface GoogleBigQueryInsertRowsResponse extends ToolResponse {
  output: {
    insertedRows: number
    errors: Array<{
      index: number
      errors: Array<{
        reason: string | null
        location: string | null
        message: string | null
      }>
    }>
  }
}

export interface GoogleBigQueryCreateDatasetResponse extends ToolResponse {
  output: {
    datasetId: string
    projectId: string
    friendlyName: string | null
    description: string | null
    location: string | null
    creationTime: string | null
  }
}

export interface GoogleBigQueryDeleteDatasetResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface GoogleBigQueryCreateTableResponse extends ToolResponse {
  output: {
    tableId: string
    datasetId: string
    projectId: string
    type: string | null
    description: string | null
    schema: Array<{
      name: string
      type: string
      mode: string | null
      description: string | null
    }>
    creationTime: string | null
    location: string | null
  }
}

export interface GoogleBigQueryDeleteTableResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface GoogleBigQueryListTableDataResponse extends ToolResponse {
  output: {
    rows: unknown[][]
    totalRows: string | null
    pageToken: string | null
  }
}

export interface GoogleBigQueryGetQueryResultsResponse extends ToolResponse {
  output: {
    columns: string[]
    rows: Record<string, unknown>[]
    totalRows: string | null
    jobComplete: boolean
    totalBytesProcessed: string | null
    cacheHit: boolean | null
    jobReference: GoogleBigQueryJobReference | null
    pageToken: string | null
  }
}
