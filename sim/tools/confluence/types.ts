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
