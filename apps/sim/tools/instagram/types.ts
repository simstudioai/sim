import type { ToolResponse } from '@/tools/types'

export interface InstagramAccessParams {
  accessToken: string
  igUserId?: string
}

export interface InstagramGetProfileParams extends InstagramAccessParams {}

export interface InstagramGetProfileResponse extends ToolResponse {
  output: {
    userId: string | null
    id: string | null
    username: string | null
    name: string | null
    accountType: string | null
    profilePictureUrl: string | null
    followersCount: number | null
    followsCount: number | null
    mediaCount: number | null
  }
}

export interface InstagramListMediaParams extends InstagramAccessParams {
  limit?: number
  after?: string
  fields?: string
}

export interface InstagramListMediaResponse extends ToolResponse {
  output: {
    media: Array<{
      id: string
      caption: string | null
      mediaType: string | null
      mediaProductType: string | null
      mediaUrl: string | null
      permalink: string | null
      timestamp: string | null
      likeCount: number | null
      commentsCount: number | null
    }>
    nextCursor: string | null
  }
}

export interface InstagramGetMediaParams {
  accessToken: string
  mediaId: string
  fields?: string
}

export interface InstagramGetMediaResponse extends ToolResponse {
  output: {
    id: string | null
    caption: string | null
    mediaType: string | null
    mediaProductType: string | null
    mediaUrl: string | null
    permalink: string | null
    timestamp: string | null
    likeCount: number | null
    commentsCount: number | null
    children: Array<{ id: string }>
  }
}

export interface InstagramListStoriesParams extends InstagramAccessParams {}

export interface InstagramListStoriesResponse extends ToolResponse {
  output: {
    stories: Array<{
      id: string
      mediaType: string | null
      mediaUrl: string | null
      timestamp: string | null
    }>
  }
}

export interface InstagramPublishImageParams extends InstagramAccessParams {
  imageUrl: string
  caption?: string
  altText?: string
  isAiGenerated?: boolean
}

export interface InstagramPublishVideoParams extends InstagramAccessParams {
  videoUrl: string
  caption?: string
  coverUrl?: string
}

export interface InstagramPublishReelParams extends InstagramAccessParams {
  videoUrl: string
  caption?: string
  coverUrl?: string
  shareToFeed?: boolean
  thumbOffset?: number
}

export interface InstagramPublishStoryParams extends InstagramAccessParams {
  imageUrl?: string
  videoUrl?: string
}

export interface InstagramPublishCarouselParams extends InstagramAccessParams {
  /** Comma-separated public image/video URLs (max 10). Prefix video URLs with video: */
  mediaUrls: string
  caption?: string
}

export interface InstagramPublishResponse extends ToolResponse {
  output: {
    containerId: string | null
    mediaId: string | null
    statusCode: string | null
  }
}

export interface InstagramGetContainerStatusParams {
  accessToken: string
  containerId: string
}

export interface InstagramGetContainerStatusResponse extends ToolResponse {
  output: {
    containerId: string
    statusCode: string | null
    status: string | null
  }
}

export interface InstagramGetPublishingLimitParams extends InstagramAccessParams {}

export interface InstagramGetPublishingLimitResponse extends ToolResponse {
  output: {
    quotaUsage: number | null
    config: {
      quotaTotal: number | null
      quotaDuration: number | null
    } | null
  }
}

export interface InstagramListCommentsParams {
  accessToken: string
  mediaId: string
  limit?: number
  after?: string
}

export interface InstagramListCommentsResponse extends ToolResponse {
  output: {
    comments: Array<{
      id: string
      text: string | null
      username: string | null
      timestamp: string | null
      likeCount: number | null
      hidden: boolean | null
    }>
    nextCursor: string | null
  }
}

export interface InstagramReplyToCommentParams {
  accessToken: string
  commentId: string
  message: string
}

export interface InstagramReplyToCommentResponse extends ToolResponse {
  output: {
    id: string | null
  }
}

export interface InstagramHideCommentParams {
  accessToken: string
  commentId: string
  hide: boolean
}

export interface InstagramHideCommentResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface InstagramDeleteCommentParams {
  accessToken: string
  commentId: string
}

export interface InstagramDeleteCommentResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface InstagramSetCommentsEnabledParams {
  accessToken: string
  mediaId: string
  commentEnabled: boolean
}

export interface InstagramSetCommentsEnabledResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface InstagramPrivateReplyParams extends InstagramAccessParams {
  commentId: string
  message: string
}

export interface InstagramPrivateReplyResponse extends ToolResponse {
  output: {
    messageId: string | null
  }
}

export interface InstagramListConversationsParams extends InstagramAccessParams {
  limit?: number
  after?: string
}

export interface InstagramListConversationsResponse extends ToolResponse {
  output: {
    conversations: Array<{
      id: string
      updatedTime: string | null
    }>
    nextCursor: string | null
  }
}

export interface InstagramGetConversationMessagesParams {
  accessToken: string
  conversationId: string
}

export interface InstagramGetConversationMessagesResponse extends ToolResponse {
  output: {
    conversationId: string
    messages: Array<{
      id: string
      createdTime: string | null
      fromId: string | null
      fromUsername: string | null
      message: string | null
    }>
  }
}

export interface InstagramGetMessageParams {
  accessToken: string
  messageId: string
}

export interface InstagramGetMessageResponse extends ToolResponse {
  output: {
    id: string | null
    createdTime: string | null
    fromId: string | null
    fromUsername: string | null
    toId: string | null
    message: string | null
  }
}

export interface InstagramSendTextMessageParams extends InstagramAccessParams {
  recipientId: string
  message: string
}

export interface InstagramSendTextMessageResponse extends ToolResponse {
  output: {
    messageId: string | null
    recipientId: string | null
  }
}

export interface InstagramGetAccountInsightsParams extends InstagramAccessParams {
  metrics: string
  period: string
  since?: string
  until?: string
  metricType?: string
  breakdown?: string
}

export interface InstagramGetAccountInsightsResponse extends ToolResponse {
  output: {
    insights: Array<{
      name: string | null
      period: string | null
      title: string | null
      description: string | null
      values: unknown[]
      totalValue: unknown
    }>
  }
}

export interface InstagramGetMediaInsightsParams {
  accessToken: string
  mediaId: string
  metrics: string
}

export interface InstagramGetMediaInsightsResponse extends ToolResponse {
  output: {
    insights: Array<{
      name: string | null
      period: string | null
      values: unknown[]
    }>
  }
}

export type InstagramResponse =
  | InstagramGetProfileResponse
  | InstagramListMediaResponse
  | InstagramGetMediaResponse
  | InstagramListStoriesResponse
  | InstagramPublishResponse
  | InstagramGetContainerStatusResponse
  | InstagramGetPublishingLimitResponse
  | InstagramListCommentsResponse
  | InstagramReplyToCommentResponse
  | InstagramHideCommentResponse
  | InstagramDeleteCommentResponse
  | InstagramSetCommentsEnabledResponse
  | InstagramPrivateReplyResponse
  | InstagramListConversationsResponse
  | InstagramGetConversationMessagesResponse
  | InstagramGetMessageResponse
  | InstagramSendTextMessageResponse
  | InstagramGetAccountInsightsResponse
  | InstagramGetMediaInsightsResponse
