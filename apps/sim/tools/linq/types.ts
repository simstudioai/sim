import type { ToolResponse } from '@/tools/types'

/** Messaging service a chat or message is delivered over. */
export type LinqServiceType = 'iMessage' | 'SMS' | 'RCS'

/** Tapback / reaction types supported by the Linq API. */
export type LinqReactionType =
  | 'love'
  | 'like'
  | 'dislike'
  | 'laugh'
  | 'emphasize'
  | 'question'
  | 'custom'
  | 'sticker'

/** A participant handle within a chat. */
export interface LinqChatHandle {
  id: string
  handle: string
  joined_at: string
  service: LinqServiceType
  is_me?: boolean
  left_at?: string | null
  status?: 'active' | 'left' | 'removed'
}

/** Health status of a chat or phone number line. */
export interface LinqHealthStatus {
  status: string
  doc_url: string
  updated_at?: string
}

interface LinqBaseParams {
  apiKey: string
}

export interface LinqCreateChatParams extends LinqBaseParams {
  from: string
  to: string[]
  text?: string
  mediaUrl?: string
  attachmentId?: string
  linkUrl?: string
  preferredService?: LinqServiceType
  effectName?: string
  effectType?: string
  replyToMessageId?: string
  replyToPartIndex?: number
  idempotencyKey?: string
}

export interface LinqCreateChatResult extends ToolResponse {
  output: {
    chatId: string
    displayName: string
    isGroup: boolean
    service: string | null
    handles: LinqChatHandle[]
    healthStatus: LinqHealthStatus | null
    message: Record<string, unknown> | null
  }
}

export interface LinqListChatsParams extends LinqBaseParams {
  cursor?: string
  from?: string
  to?: string
  limit?: number
}

export interface LinqListChatsResult extends ToolResponse {
  output: {
    chats: Array<Record<string, unknown>>
    nextCursor: string | null
  }
}

export interface LinqGetChatParams extends LinqBaseParams {
  chatId: string
}

export interface LinqChatResult extends ToolResponse {
  output: {
    id: string
    displayName: string
    isGroup: boolean
    isArchived: boolean | null
    service: string | null
    createdAt: string | null
    updatedAt: string | null
    handles: LinqChatHandle[]
    healthStatus: LinqHealthStatus | null
  }
}

export interface LinqUpdateChatParams extends LinqBaseParams {
  chatId: string
  displayName?: string
  groupChatIcon?: string
}

export interface LinqUpdateChatResult extends ToolResponse {
  output: {
    chatId: string | null
    status: string | null
  }
}

export interface LinqChatActionParams extends LinqBaseParams {
  chatId: string
}

/** Generic success-shaped response used by simple action endpoints. */
export interface LinqSuccessResult extends ToolResponse {
  output: {
    success: boolean
  }
}

/** Queued-action response: { message, status, trace_id }. */
export interface LinqQueuedResult extends ToolResponse {
  output: {
    message: string | null
    status: string | null
    traceId: string | null
  }
}

export interface LinqSendVoiceMemoParams extends LinqBaseParams {
  chatId: string
  voiceMemoUrl?: string
  attachmentId?: string
}

export interface LinqSendVoiceMemoResult extends ToolResponse {
  output: {
    id: string
    status: string | null
    from: string | null
    to: string[]
    service: string | null
    voiceMemo: Record<string, unknown> | null
  }
}

export interface LinqParticipantParams extends LinqBaseParams {
  chatId: string
  handle: string
}

export interface LinqSendMessageParams extends LinqBaseParams {
  chatId: string
  text?: string
  mediaUrl?: string
  attachmentId?: string
  linkUrl?: string
  preferredService?: LinqServiceType
  effectName?: string
  effectType?: string
  replyToMessageId?: string
  replyToPartIndex?: number
  idempotencyKey?: string
}

export interface LinqSendMessageResult extends ToolResponse {
  output: {
    chatId: string
    messageId: string
    deliveryStatus: string | null
    sentAt: string | null
    service: string | null
    message: Record<string, unknown> | null
  }
}

export interface LinqListMessagesParams extends LinqBaseParams {
  chatId: string
  cursor?: string
  limit?: number
}

export interface LinqListThreadParams extends LinqBaseParams {
  messageId: string
  cursor?: string
  limit?: number
  order?: 'asc' | 'desc'
}

export interface LinqListMessagesResult extends ToolResponse {
  output: {
    messages: Array<Record<string, unknown>>
    nextCursor: string | null
  }
}

export interface LinqGetMessageParams extends LinqBaseParams {
  messageId: string
}

export interface LinqMessageResult extends ToolResponse {
  output: {
    id: string
    chatId: string
    isFromMe: boolean | null
    isDelivered: boolean | null
    isRead: boolean | null
    service: string | null
    createdAt: string | null
    updatedAt: string | null
    sentAt: string | null
    parts: Array<Record<string, unknown>>
    message: Record<string, unknown>
  }
}

export interface LinqEditMessageParams extends LinqBaseParams {
  messageId: string
  text: string
  partIndex?: number
}

export interface LinqDeleteMessageParams extends LinqBaseParams {
  messageId: string
}

export interface LinqReactToMessageParams extends LinqBaseParams {
  messageId: string
  operation: 'add' | 'remove'
  type: LinqReactionType
  customEmoji?: string
  partIndex?: number
}

export interface LinqCreateAttachmentParams extends LinqBaseParams {
  /** UserFile object (or reference) to upload. */
  file?: unknown
  /** Legacy base64 file content fallback. */
  fileContent?: string
  filename?: string
  contentType?: string
}

export interface LinqCreateAttachmentResult extends ToolResponse {
  output: {
    attachmentId: string
    downloadUrl: string | null
    filename: string
    contentType: string
    sizeBytes: number
    status: string
  }
}

export interface LinqGetAttachmentParams extends LinqBaseParams {
  attachmentId: string
}

export interface LinqAttachmentResult extends ToolResponse {
  output: {
    id: string
    filename: string
    contentType: string
    sizeBytes: number | null
    status: string
    downloadUrl: string | null
    createdAt: string | null
  }
}

export interface LinqDeleteAttachmentParams extends LinqBaseParams {
  attachmentId: string
}

export interface LinqListPhoneNumbersParams extends LinqBaseParams {}

export interface LinqListPhoneNumbersResult extends ToolResponse {
  output: {
    phoneNumbers: Array<{
      id: string
      phoneNumber: string
      healthStatus: LinqHealthStatus | null
    }>
  }
}

export interface LinqCapabilityCheckParams extends LinqBaseParams {
  address: string
  from?: string
}

export interface LinqCapabilityCheckResult extends ToolResponse {
  output: {
    address: string
    available: boolean
  }
}

export interface LinqGetContactCardParams extends LinqBaseParams {
  phoneNumber?: string
}

export interface LinqGetContactCardResult extends ToolResponse {
  output: {
    contactCards: Array<{
      phoneNumber: string
      firstName: string
      lastName: string | null
      imageUrl: string | null
      isActive: boolean
    }>
  }
}

export interface LinqCreateContactCardParams extends LinqBaseParams {
  phoneNumber: string
  firstName: string
  lastName?: string
  imageUrl?: string
}

export interface LinqUpdateContactCardParams extends LinqBaseParams {
  phoneNumber: string
  firstName?: string
  lastName?: string
  imageUrl?: string
}

export interface LinqContactCardResult extends ToolResponse {
  output: {
    phoneNumber: string
    firstName: string
    lastName: string | null
    imageUrl: string | null
    isActive: boolean
  }
}

export interface LinqWebhookSubscription {
  id: string
  targetUrl: string
  subscribedEvents: string[]
  phoneNumbers: string[] | null
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface LinqCreateWebhookSubscriptionParams extends LinqBaseParams {
  targetUrl: string
  subscribedEvents: string[]
  phoneNumbers?: string[]
}

export interface LinqCreateWebhookSubscriptionResult extends ToolResponse {
  output: LinqWebhookSubscription & { signingSecret: string }
}

export interface LinqListWebhookSubscriptionsParams extends LinqBaseParams {}

export interface LinqListWebhookSubscriptionsResult extends ToolResponse {
  output: {
    subscriptions: LinqWebhookSubscription[]
  }
}

export interface LinqGetWebhookSubscriptionParams extends LinqBaseParams {
  subscriptionId: string
}

export interface LinqWebhookSubscriptionResult extends ToolResponse {
  output: LinqWebhookSubscription
}

export interface LinqUpdateWebhookSubscriptionParams extends LinqBaseParams {
  subscriptionId: string
  targetUrl?: string
  subscribedEvents?: string[]
  phoneNumbers?: string[]
  isActive?: boolean
}

export interface LinqDeleteWebhookSubscriptionParams extends LinqBaseParams {
  subscriptionId: string
}

export interface LinqListWebhookEventsParams extends LinqBaseParams {}

export interface LinqListWebhookEventsResult extends ToolResponse {
  output: {
    events: string[]
    docUrl: string | null
  }
}
