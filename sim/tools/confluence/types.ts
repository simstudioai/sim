import { ToolResponse } from '../types'

export interface ConfluenceRetrieveParams {
  accessToken: string
  pageId: string
  domain: string
}

export interface ConfluenceRetrieveResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    content: string
    title: string
  }
}

export interface ConfluenceListParams {
  accessToken: string
  domain: string
  limit?: number
  spaceKey?: string
  title?: string
}

export interface ConfluencePage {
  id: string
  title: string
  spaceKey?: string
  url?: string
  lastModified?: string
}

export interface ConfluenceListResponse extends ToolResponse {
  output: {
    ts: string
    pages: ConfluencePage[]
  }
}

export interface ConfluenceUpdateParams {
  accessToken: string
  domain: string
  pageId: string
  title?: string
  content?: string
  version?: number
}

export interface ConfluenceUpdateResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    title: string
    success: boolean
  }
}
