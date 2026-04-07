import type { ToolResponse } from '@/tools/types'

/** Create Inbox */
export interface CreateInboxParams {
  apiKey: string
  username?: string
  domain?: string
  displayName?: string
}

export interface CreateInboxResult extends ToolResponse {
  output: {
    inboxId: string
    email: string
    displayName: string | null
    createdAt: string
    updatedAt: string
  }
}

/** List Inboxes */
export interface ListInboxesParams {
  apiKey: string
  limit?: number
  pageToken?: string
}

export interface ListInboxesResult extends ToolResponse {
  output: {
    inboxes: Array<{
      inboxId: string
      email: string
      displayName: string | null
      createdAt: string
      updatedAt: string
    }>
    count: number
    nextPageToken: string | null
  }
}

/** Get Inbox */
export interface GetInboxParams {
  apiKey: string
  inboxId: string
}

export interface GetInboxResult extends ToolResponse {
  output: {
    inboxId: string
    email: string
    displayName: string | null
    createdAt: string
    updatedAt: string
  }
}

/** Update Inbox */
export interface UpdateInboxParams {
  apiKey: string
  inboxId: string
  displayName: string
}

export interface UpdateInboxResult extends ToolResponse {
  output: {
    inboxId: string
    email: string
    displayName: string | null
    createdAt: string
    updatedAt: string
  }
}

/** Delete Inbox */
export interface DeleteInboxParams {
  apiKey: string
  inboxId: string
}

export interface DeleteInboxResult extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** Send Message (Create Thread) */
export interface SendMessageParams {
  apiKey: string
  inboxId: string
  to: string
  subject: string
  text?: string
  html?: string
  cc?: string
  bcc?: string
}

export interface SendMessageResult extends ToolResponse {
  output: {
    threadId: string
    messageId: string
    subject: string
    to: string
  }
}

/** Reply to Message */
export interface ReplyMessageParams {
  apiKey: string
  inboxId: string
  messageId: string
  text?: string
  html?: string
  to?: string
  cc?: string
  bcc?: string
  replyAll?: boolean
}

export interface ReplyMessageResult extends ToolResponse {
  output: {
    messageId: string
    threadId: string
  }
}

/** Forward Message */
export interface ForwardMessageParams {
  apiKey: string
  inboxId: string
  messageId: string
  to: string
  subject?: string
  text?: string
  html?: string
  cc?: string
  bcc?: string
}

export interface ForwardMessageResult extends ToolResponse {
  output: {
    messageId: string
    threadId: string
  }
}

/** Update Message Labels */
export interface UpdateMessageParams {
  apiKey: string
  inboxId: string
  messageId: string
  addLabels?: string
  removeLabels?: string
}

export interface UpdateMessageResult extends ToolResponse {
  output: {
    messageId: string
    labels: string[]
  }
}

/** Create Draft */
export interface CreateDraftParams {
  apiKey: string
  inboxId: string
  to?: string
  subject?: string
  text?: string
  html?: string
  cc?: string
  bcc?: string
  inReplyTo?: string
  sendAt?: string
}

export interface CreateDraftResult extends ToolResponse {
  output: {
    draftId: string
    inboxId: string
    subject: string | null
    to: string[]
    cc: string[]
    bcc: string[]
    text: string | null
    html: string | null
    preview: string | null
    labels: string[]
    inReplyTo: string | null
    sendStatus: string | null
    sendAt: string | null
    createdAt: string
    updatedAt: string
  }
}

/** Update Draft */
export interface UpdateDraftParams {
  apiKey: string
  inboxId: string
  draftId: string
  to?: string
  subject?: string
  text?: string
  html?: string
  cc?: string
  bcc?: string
  sendAt?: string
}

export interface UpdateDraftResult extends ToolResponse {
  output: {
    draftId: string
    inboxId: string
    subject: string | null
    to: string[]
    cc: string[]
    bcc: string[]
    text: string | null
    html: string | null
    preview: string | null
    labels: string[]
    inReplyTo: string | null
    sendStatus: string | null
    sendAt: string | null
    createdAt: string
    updatedAt: string
  }
}

/** Delete Draft */
export interface DeleteDraftParams {
  apiKey: string
  inboxId: string
  draftId: string
}

export interface DeleteDraftResult extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** Send Draft */
export interface SendDraftParams {
  apiKey: string
  inboxId: string
  draftId: string
}

export interface SendDraftResult extends ToolResponse {
  output: {
    messageId: string
    threadId: string
  }
}

/** List Drafts */
export interface ListDraftsParams {
  apiKey: string
  inboxId: string
  limit?: number
  pageToken?: string
}

export interface ListDraftsResult extends ToolResponse {
  output: {
    drafts: Array<{
      draftId: string
      inboxId: string
      subject: string | null
      to: string[]
      cc: string[]
      bcc: string[]
      preview: string | null
      sendStatus: string | null
      sendAt: string | null
      createdAt: string
      updatedAt: string
    }>
    count: number
    nextPageToken: string | null
  }
}

/** Get Draft */
export interface GetDraftParams {
  apiKey: string
  inboxId: string
  draftId: string
}

export interface GetDraftResult extends ToolResponse {
  output: {
    draftId: string
    inboxId: string
    subject: string | null
    to: string[]
    cc: string[]
    bcc: string[]
    text: string | null
    html: string | null
    preview: string | null
    labels: string[]
    inReplyTo: string | null
    sendStatus: string | null
    sendAt: string | null
    createdAt: string
    updatedAt: string
  }
}

/** List Threads */
export interface ListThreadsParams {
  apiKey: string
  inboxId: string
  limit?: number
  pageToken?: string
  labels?: string
  before?: string
  after?: string
}

export interface ListThreadsResult extends ToolResponse {
  output: {
    threads: Array<{
      threadId: string
      subject: string | null
      senders: string[]
      recipients: string[]
      messageCount: number
      lastMessageAt: string | null
      createdAt: string
      updatedAt: string
    }>
    count: number
    nextPageToken: string | null
  }
}

/** Get Thread */
export interface GetThreadParams {
  apiKey: string
  inboxId: string
  threadId: string
}

export interface GetThreadResult extends ToolResponse {
  output: {
    threadId: string
    subject: string | null
    senders: string[]
    recipients: string[]
    messageCount: number
    labels: string[]
    lastMessageAt: string | null
    createdAt: string
    updatedAt: string
    messages: Array<{
      messageId: string
      from: string | null
      to: string[]
      cc: string[]
      bcc: string[]
      subject: string | null
      text: string | null
      html: string | null
      createdAt: string
    }>
  }
}

/** Update Thread Labels */
export interface UpdateThreadParams {
  apiKey: string
  inboxId: string
  threadId: string
  addLabels?: string
  removeLabels?: string
}

export interface UpdateThreadResult extends ToolResponse {
  output: {
    threadId: string
    labels: string[]
  }
}

/** Delete Thread */
export interface DeleteThreadParams {
  apiKey: string
  inboxId: string
  threadId: string
  permanent?: boolean
}

export interface DeleteThreadResult extends ToolResponse {
  output: {
    deleted: boolean
  }
}

/** List Messages */
export interface ListMessagesParams {
  apiKey: string
  inboxId: string
  limit?: number
  pageToken?: string
}

export interface ListMessagesResult extends ToolResponse {
  output: {
    messages: Array<{
      messageId: string
      from: string | null
      to: string[]
      subject: string | null
      preview: string | null
      createdAt: string
    }>
    count: number
    nextPageToken: string | null
  }
}

/** Get Message */
export interface GetMessageParams {
  apiKey: string
  inboxId: string
  messageId: string
}

export interface GetMessageResult extends ToolResponse {
  output: {
    messageId: string
    threadId: string
    from: string | null
    to: string[]
    cc: string[]
    bcc: string[]
    subject: string | null
    text: string | null
    html: string | null
    createdAt: string
  }
}
