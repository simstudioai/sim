import type { ToolResponse } from '../types'

export interface OutlookSendParams {
  accessToken: string
  to: string
  subject: string
  body: string
}

export interface OutlookSendResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}

export interface OutlookReadParams {
  accessToken: string
  folder: string
  maxResults: number
  messageId?: string
}

export interface OutlookReadResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}

export interface OutlookDraftParams {
  accessToken: string
  to: string
  subject: string
  body: string
}

export interface OutlookDraftResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}
