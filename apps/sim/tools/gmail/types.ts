import type { ToolResponse } from '@/tools/types'

// Base parameters shared by all operations
interface BaseGmailParams {
  accessToken: string
}

// Send operation parameters
export interface GmailSendParams extends BaseGmailParams {
  to: string
  subject: string
  body: string
}

// Read operation parameters
export interface GmailReadParams extends BaseGmailParams {
  messageId: string
  folder: string
  unreadOnly?: boolean
  maxResults?: number
}

// Search operation parameters
export interface GmailSearchParams extends BaseGmailParams {
  query: string
  maxResults?: number
}

// Union type for all Gmail tool parameters
export type GmailToolParams = GmailSendParams | GmailReadParams | GmailSearchParams

// Response metadata
interface BaseGmailMetadata {
  id?: string
  threadId?: string
  labelIds?: string[]
}

interface EmailMetadata extends BaseGmailMetadata {
  from?: string
  to?: string
  subject?: string
  date?: string
}

interface SearchMetadata extends BaseGmailMetadata {
  results: Array<{
    id: string
    threadId: string
  }>
}

// Response format
export interface GmailToolResponse extends ToolResponse {
  output: {
    content: string
    metadata: EmailMetadata | SearchMetadata
  }
}

// Email Message Interface
export interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  payload: {
    headers: Array<{
      name: string
      value: string
    }>
    body: {
      data?: string
    }
    parts?: Array<{
      mimeType: string
      body: {
        data?: string
      }
    }>
  }
}
