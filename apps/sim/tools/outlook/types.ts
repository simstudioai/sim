import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for Microsoft Graph Outlook API responses.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/message
 */

/**
 * Output definition for email address objects.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/emailaddress
 */
export const OUTLOOK_EMAIL_ADDRESS_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Display name of the person or entity', optional: true },
  address: { type: 'string', description: 'Email address' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for message body objects.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/itembody
 */
export const OUTLOOK_MESSAGE_BODY_OUTPUT_PROPERTIES = {
  contentType: { type: 'string', description: 'Body content type (text or html)', optional: true },
  content: { type: 'string', description: 'Body content', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for cleaned message objects returned by our tools.
 */
export const OUTLOOK_MESSAGE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique message identifier' },
  subject: { type: 'string', description: 'Email subject', optional: true },
  bodyPreview: { type: 'string', description: 'Preview of the message body', optional: true },
  body: {
    type: 'object',
    description: 'Message body',
    optional: true,
    properties: OUTLOOK_MESSAGE_BODY_OUTPUT_PROPERTIES,
  },
  sender: {
    type: 'object',
    description: 'Sender information',
    optional: true,
    properties: OUTLOOK_EMAIL_ADDRESS_OUTPUT_PROPERTIES,
  },
  from: {
    type: 'object',
    description: 'From address information',
    optional: true,
    properties: OUTLOOK_EMAIL_ADDRESS_OUTPUT_PROPERTIES,
  },
  toRecipients: {
    type: 'array',
    description: 'To recipients',
    items: {
      type: 'object',
      properties: OUTLOOK_EMAIL_ADDRESS_OUTPUT_PROPERTIES,
    },
  },
  ccRecipients: {
    type: 'array',
    description: 'CC recipients',
    items: {
      type: 'object',
      properties: OUTLOOK_EMAIL_ADDRESS_OUTPUT_PROPERTIES,
    },
  },
  receivedDateTime: {
    type: 'string',
    description: 'When the message was received (ISO 8601)',
    optional: true,
  },
  sentDateTime: {
    type: 'string',
    description: 'When the message was sent (ISO 8601)',
    optional: true,
  },
  hasAttachments: {
    type: 'boolean',
    description: 'Whether the message has attachments',
    optional: true,
  },
  isRead: { type: 'boolean', description: 'Whether the message has been read', optional: true },
  importance: {
    type: 'string',
    description: 'Message importance (low, normal, high)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete message output definition
 */
export const OUTLOOK_MESSAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Outlook email message',
  properties: OUTLOOK_MESSAGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for attachment objects.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/attachment
 */
export const OUTLOOK_ATTACHMENT_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Attachment filename' },
  contentType: { type: 'string', description: 'MIME type of the attachment' },
  size: { type: 'number', description: 'Attachment size in bytes' },
} as const satisfies Record<string, OutputProperty>

export interface OutlookSendParams {
  accessToken: string
  to: string
  subject: string
  body: string
  contentType?: 'text' | 'html'
  replyToMessageId?: string
  cc?: string
  bcc?: string
  attachments?: UserFile[]
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
  includeAttachments?: boolean
}

export interface OutlookReadResponse extends ToolResponse {
  output: {
    message: string
    results: CleanedOutlookMessage[]
  }
}

export interface OutlookDraftParams {
  accessToken: string
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
  contentType?: 'text' | 'html'
  attachments?: UserFile[]
}

export interface OutlookDraftResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}

// Outlook API response interfaces
interface OutlookEmailAddress {
  name?: string
  address: string
}

interface OutlookRecipient {
  emailAddress: OutlookEmailAddress
}

interface OutlookMessageBody {
  contentType?: string
  content?: string
}

export interface OutlookMessage {
  id: string
  subject?: string
  bodyPreview?: string
  body?: OutlookMessageBody
  sender?: OutlookRecipient
  from?: OutlookRecipient
  toRecipients?: OutlookRecipient[]
  ccRecipients?: OutlookRecipient[]
  bccRecipients?: OutlookRecipient[]
  receivedDateTime?: string
  sentDateTime?: string
  hasAttachments?: boolean
  isRead?: boolean
  importance?: string
  // Add other common fields
  '@odata.etag'?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  changeKey?: string
  categories?: string[]
  internetMessageId?: string
  parentFolderId?: string
  conversationId?: string
  conversationIndex?: string
  isDeliveryReceiptRequested?: boolean | null
  isReadReceiptRequested?: boolean
  isDraft?: boolean
  webLink?: string
  inferenceClassification?: string
  replyTo?: OutlookRecipient[]
}

export interface OutlookMessagesResponse {
  '@odata.context'?: string
  '@odata.nextLink'?: string
  value: OutlookMessage[]
}

// Outlook attachment interface (for tool responses)
export interface OutlookAttachment {
  name: string
  data: string
  contentType: string
  size: number
}

// Cleaned message interface for our response
export interface CleanedOutlookMessage {
  id: string
  subject?: string
  bodyPreview?: string
  body?: {
    contentType?: string
    content?: string
  }
  sender?: {
    name?: string
    address?: string
  }
  from?: {
    name?: string
    address?: string
  }
  toRecipients: Array<{
    name?: string
    address?: string
  }>
  ccRecipients: Array<{
    name?: string
    address?: string
  }>
  receivedDateTime?: string
  sentDateTime?: string
  hasAttachments?: boolean
  attachments?: OutlookAttachment[] | any[]
  isRead?: boolean
  importance?: string
}

export type OutlookResponse = OutlookReadResponse | OutlookSendResponse | OutlookDraftResponse

export interface OutlookForwardParams {
  accessToken: string
  messageId: string
  to: string
  comment?: string
}

export interface OutlookForwardResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
}

export interface OutlookMoveParams {
  accessToken: string
  messageId: string
  destinationId: string
}

export interface OutlookMoveResponse extends ToolResponse {
  output: {
    message: string
    results: {
      messageId: string
      newFolderId: string
    }
  }
}

export interface OutlookMarkReadParams {
  accessToken: string
  messageId: string
}

export interface OutlookMarkReadResponse extends ToolResponse {
  output: {
    message: string
    results: {
      messageId: string
      isRead: boolean
    }
  }
}

export interface OutlookDeleteParams {
  accessToken: string
  messageId: string
}

export interface OutlookDeleteResponse extends ToolResponse {
  output: {
    message: string
    results: {
      messageId: string
      status: string
    }
  }
}

export interface OutlookCopyParams {
  accessToken: string
  messageId: string
  destinationId: string
}

export interface OutlookCopyResponse extends ToolResponse {
  output: {
    message: string
    results: {
      originalMessageId: string
      copiedMessageId: string
      destinationFolderId: string
    }
  }
}

export type OutlookExtendedResponse =
  | OutlookResponse
  | OutlookForwardResponse
  | OutlookMoveResponse
  | OutlookMarkReadResponse
  | OutlookDeleteResponse
  | OutlookCopyResponse

/**
 * Output definition for mail folder objects.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/mailfolder
 */
export const OUTLOOK_FOLDER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique folder identifier' },
  displayName: { type: 'string', description: 'Display name of the folder', optional: true },
  parentFolderId: {
    type: 'string',
    description: 'Identifier of the parent folder',
    optional: true,
  },
  childFolderCount: {
    type: 'number',
    description: 'Number of immediate child folders',
    optional: true,
  },
  unreadItemCount: {
    type: 'number',
    description: 'Number of unread items in the folder',
    optional: true,
  },
  totalItemCount: {
    type: 'number',
    description: 'Total number of items in the folder',
    optional: true,
  },
  isHidden: { type: 'boolean', description: 'Whether the folder is hidden', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for attachment metadata returned by list/get attachment tools.
 */
export const OUTLOOK_ATTACHMENT_METADATA_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique attachment identifier' },
  name: { type: 'string', description: 'Attachment filename', optional: true },
  contentType: { type: 'string', description: 'MIME type of the attachment', optional: true },
  size: { type: 'number', description: 'Attachment size in bytes', optional: true },
  isInline: {
    type: 'boolean',
    description: 'Whether the attachment is rendered inline in the message body',
    optional: true,
  },
  attachmentType: {
    type: 'string',
    description: 'Microsoft Graph attachment type (e.g. #microsoft.graph.fileAttachment)',
    optional: true,
  },
  lastModifiedDateTime: {
    type: 'string',
    description: 'When the attachment was last modified (ISO 8601)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Cleaned mail folder returned by our tools. */
export interface CleanedOutlookFolder {
  id: string
  displayName?: string | null
  parentFolderId?: string | null
  childFolderCount?: number | null
  unreadItemCount?: number | null
  totalItemCount?: number | null
  isHidden?: boolean | null
}

/** Cleaned attachment metadata returned by our tools. */
export interface CleanedOutlookAttachmentMetadata {
  id: string
  name?: string | null
  contentType?: string | null
  size?: number | null
  isInline?: boolean | null
  attachmentType?: string | null
  lastModifiedDateTime?: string | null
}

export interface OutlookReplyParams {
  accessToken: string
  messageId: string
  comment?: string
}

export interface OutlookReplyResponse extends ToolResponse {
  output: {
    message: string
    results: {
      status: string
      timestamp: string
      httpStatus?: number
      requestId?: string
    }
  }
}

export interface OutlookListFoldersParams {
  accessToken: string
  maxResults?: number
  includeHiddenFolders?: boolean
}

export interface OutlookListFoldersResponse extends ToolResponse {
  output: {
    message: string
    results: CleanedOutlookFolder[]
  }
}

export interface OutlookCreateFolderParams {
  accessToken: string
  displayName: string
  isHidden?: boolean
}

export interface OutlookCreateFolderResponse extends ToolResponse {
  output: {
    message: string
    results: CleanedOutlookFolder
  }
}

export interface OutlookListAttachmentsParams {
  accessToken: string
  messageId: string
}

export interface OutlookListAttachmentsResponse extends ToolResponse {
  output: {
    message: string
    results: CleanedOutlookAttachmentMetadata[]
  }
}

export interface OutlookGetAttachmentParams {
  accessToken: string
  messageId: string
  attachmentId: string
}

export interface OutlookGetAttachmentResponse extends ToolResponse {
  output: {
    message: string
    results: CleanedOutlookAttachmentMetadata
    attachments: OutlookAttachment[]
  }
}

export interface OutlookSearchParams {
  accessToken: string
  query: string
  maxResults?: number
}

export interface OutlookSearchResponse extends ToolResponse {
  output: {
    message: string
    results: CleanedOutlookMessage[]
  }
}

export interface OutlookUpdateMessageParams {
  accessToken: string
  messageId: string
  categories?: string[]
  flagStatus?: 'notFlagged' | 'flagged' | 'complete'
  importance?: 'low' | 'normal' | 'high'
}

export interface OutlookUpdateMessageResponse extends ToolResponse {
  output: {
    message: string
    results: {
      messageId: string
      subject?: string | null
      categories: string[]
      flagStatus?: string | null
      importance?: string | null
      isRead?: boolean | null
    }
  }
}
