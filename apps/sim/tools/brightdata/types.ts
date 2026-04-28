import type { ToolResponse } from '@/tools/types'

export interface BrightDataScrapeUrlParams {
  apiKey: string
  zone: string
  url: string
  format?: string
  country?: string
}

export interface BrightDataScrapeUrlResponse extends ToolResponse {
  output: {
    content: string
    url: string | null
    statusCode: number | null
  }
}

export interface BrightDataSerpSearchParams {
  apiKey: string
  zone: string
  query: string
  searchEngine?: string
  country?: string
  language?: string
  numResults?: number
}

export interface BrightDataSerpSearchResponse extends ToolResponse {
  output: {
    results: Array<{
      title: string | null
      url: string | null
      description: string | null
      rank: number | null
    }>
    query: string | null
    searchEngine: string | null
  }
}

export interface BrightDataScrapeDatasetParams {
  apiKey: string
  datasetId: string
  urls: string
  format?: string
}

export interface BrightDataScrapeDatasetResponse extends ToolResponse {
  output: {
    snapshotId: string
    status: string
  }
}

export interface BrightDataSyncScrapeParams {
  apiKey: string
  datasetId: string
  urls: string
  format?: string
  includeErrors?: boolean
}

export interface BrightDataSyncScrapeResponse extends ToolResponse {
  output: {
    data: Array<Record<string, unknown>>
    snapshotId: string | null
    isAsync: boolean
  }
}

export interface BrightDataSnapshotStatusParams {
  apiKey: string
  snapshotId: string
}

export interface BrightDataSnapshotStatusResponse extends ToolResponse {
  output: {
    snapshotId: string | null
    datasetId: string | null
    status: string
  }
}

export interface BrightDataDownloadSnapshotParams {
  apiKey: string
  snapshotId: string
  format?: string
  compress?: boolean
}

export interface BrightDataDownloadSnapshotResponse extends ToolResponse {
  output: {
    data: Array<Record<string, unknown>>
    format: string
    snapshotId: string | null
  }
}

export interface BrightDataCancelSnapshotParams {
  apiKey: string
  snapshotId: string
}

export interface BrightDataCancelSnapshotResponse extends ToolResponse {
  output: {
    snapshotId: string | null
    cancelled: boolean
  }
}

export interface BrightDataDiscoverParams {
  apiKey: string
  query: string
  numResults?: number
  intent?: string
  includeContent?: boolean
  format?: string
  language?: string
  country?: string
}

export interface BrightDataDiscoverResponse extends ToolResponse {
  output: {
    results: Array<{
      url: string | null
      title: string | null
      description: string | null
      relevanceScore: number | null
      content: string | null
    }>
    query: string | null
    totalResults: number
    taskId?: string | null
  }
}

export type BrightDataResponse =
  | BrightDataScrapeUrlResponse
  | BrightDataSerpSearchResponse
  | BrightDataScrapeDatasetResponse
  | BrightDataSyncScrapeResponse
  | BrightDataSnapshotStatusResponse
  | BrightDataDownloadSnapshotResponse
  | BrightDataCancelSnapshotResponse
  | BrightDataDiscoverResponse
