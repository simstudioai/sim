import type { ToolResponse } from '@/tools/types'

export interface GoogleBigQueryBaseParams {
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

export interface GoogleBigQueryJobReference {
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
