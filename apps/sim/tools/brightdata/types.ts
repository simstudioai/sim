import type { ToolResponse } from '@/tools/types'

export interface BrightDataAuthParams {
  apiToken: string
  unlockerZone?: string
  browserZone?: string
}


export interface ScrapeMarkdownParams extends BrightDataAuthParams {
  url: string
}


export interface ScrapeMarkdownResponse extends ToolResponse {
  output: {
    markdown: string
    url: string
    title?: string
  }
}


export interface SearchEngineParams extends BrightDataAuthParams {
  query: string
  maxResults?: number
}


export interface SearchEngineResponse extends ToolResponse {
  output: {
    results: Array<{
      title: string
      url: string
      snippet: string
    }>
  }
}


export interface BrowserNavigateParams extends BrightDataAuthParams {
  url: string
  sessionKey?: string
  country?: string
}


export interface BrowserNavigateResponse extends ToolResponse {
  output: {
    success: boolean
    url: string
    title?: string
    sessionKey?: string
  }
}


export interface BrowserSnapshotParams extends BrightDataAuthParams {
  sessionKey?: string
}


export interface BrowserSnapshotResponse extends ToolResponse {
  output: {
    html: string
    url: string
    title?: string
  }
}


export interface BrowserScreenshotParams extends BrightDataAuthParams {
  sessionKey?: string
}


export interface BrowserScreenshotResponse extends ToolResponse {
  output: {
    image: string
    url: string
  }
}


export interface DatasetParams extends BrightDataAuthParams {
  datasetId: string
  url?: string
  keyword?: string
  [key: string]: unknown
}


export interface DatasetResponse extends ToolResponse {
  output: {
    data: unknown
    snapshot_at?: string
  }
}


export type BrightDataResponse =
  | ScrapeMarkdownResponse
  | SearchEngineResponse
  | BrowserNavigateResponse
  | BrowserSnapshotResponse
  | BrowserScreenshotResponse
  | DatasetResponse
