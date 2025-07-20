import type { ToolResponse } from '@/tools/types'

export interface ConfluenceRetrieveParams {
  accessToken: string
  pageId: string
  domain: string
  cloudId?: string
}

export interface ConfluenceRetrieveResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    content: string
    title: string
  }
}

export interface ConfluencePage {
  id: string
  title: string
  spaceKey?: string
  url?: string
  lastModified?: string
}

export interface ConfluenceUpdateParams {
  accessToken: string
  domain: string
  pageId: string
  title?: string
  content?: string
  version?: number
  cloudId?: string
}

export interface ConfluenceUpdateResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    title: string
    success: boolean
  }
}

export type ConfluenceResponse = ConfluenceRetrieveResponse | ConfluenceUpdateResponse
