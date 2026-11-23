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
  replyTo?: string
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
  pageToken?: string
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

// Response metadata
interface BaseGmailMetadata {
  id?: string
  threadId?: string
  labelIds?: string[]
}

/** Recipient and threading headers; each is `null` when the message does not carry it. */
export interface GmailExtendedHeaders {
  cc: string | null
  bcc: string | null
  replyTo: string | null
  /** RFC 5322 `Message-ID` header, distinct from the Gmail message `id`. */
  rfcMessageId: string | null
  inReplyTo: string | null
  references: string | null
}

interface EmailMetadata extends BaseGmailMetadata, Partial<GmailExtendedHeaders> {
  from?: string
  to?: string
  subject?: string
  date?: string
  hasAttachments?: boolean
  attachmentCount?: number
  snippet?: string | null
  internalDate?: string | null
}

export interface GmailMessageSummary extends Partial<GmailExtendedHeaders> {
  id: string
  threadId: string
  subject: string
  from: string
  to: string
  date: string
  snippet: string
  internalDate?: string | null
}

interface SearchMetadata extends BaseGmailMetadata {
  results: Array<{ id: string; threadId: string } & Partial<GmailMessageSummary>>
  nextPageToken?: string | null
  resultSizeEstimate?: number | null
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
  internalDate?: string
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
  data: Buffer | string
  mimeType: string
  size: number
}
