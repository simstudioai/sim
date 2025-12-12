import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

// Base parameters shared by all operations
interface BaseGmailParams {
  accessToken: string
}

// Send operation parameters
export interface GmailSendParams extends BaseGmailParams {
  to: string
  cc?: string
  bcc?: string
  subject?: string
  body: string
  contentType?: 'text' | 'html'
  threadId?: string
  replyToMessageId?: string
  attachments?: UserFile[]
}

// Read operation parameters
export interface GmailReadParams extends BaseGmailParams {
  messageId: string
  folder: string
  unreadOnly?: boolean
  maxResults?: number
  includeAttachments?: boolean
}

// Search operation parameters
export interface GmailSearchParams extends BaseGmailParams {
  query: string
  maxResults?: number
}

// Move operation parameters
export interface GmailMoveParams extends BaseGmailParams {
  messageId: string
  addLabelIds: string
  removeLabelIds?: string
}

// Mark as read/unread parameters (reuses simple messageId pattern)
export interface GmailMarkReadParams extends BaseGmailParams {
  messageId: string
}

// Label management parameters
export interface GmailLabelParams extends BaseGmailParams {
  messageId: string
  labelIds: string
}

// Union type for all Gmail tool parameters
export type GmailToolParams =
  | GmailSendParams
  | GmailReadParams
  | GmailSearchParams
  | GmailMoveParams
  | GmailMarkReadParams
  | GmailLabelParams

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
  hasAttachments?: boolean
  attachmentCount?: number
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
    attachments?: GmailAttachment[]
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
      attachmentId?: string
      size?: number
    }
    parts?: Array<{
      mimeType: string
      filename?: string
      body: {
        data?: string
        attachmentId?: string
        size?: number
      }
      parts?: Array<any>
    }>
  }
}

// Gmail Attachment Interface (for processed attachments)
export interface GmailAttachment {
  name: string
  data: Buffer
  mimeType: string
  size: number
}
