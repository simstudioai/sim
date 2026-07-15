import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

/** Shared outputs returned by every Instagram publishing operation. */
export const PUBLISH_OUTPUTS = {
  containerId: { type: 'string', description: 'Media container ID', optional: true },
  mediaId: { type: 'string', description: 'Published media ID', optional: true },
  statusCode: { type: 'string', description: 'Final container status', optional: true },
} satisfies Record<string, OutputProperty>

export interface InstagramAccessParams {
  accessToken: string
  igUserId?: string
}

export interface InstagramGetProfileParams {
  accessToken: string
}

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

export interface InstagramDownloadMediaParams {
  accessToken: string
  mediaId: string
  filename?: string
  _context?: WorkflowToolExecutionContext
}

export interface InstagramDownloadMediaResponse extends ToolResponse {
  output: {
    files: UserFile[]
    mediaId: string
    mediaType: string | null
    downloadedCount: number
  }
}

export interface InstagramListStoriesParams extends InstagramAccessParams {
  limit?: number
  after?: string
}

export interface InstagramListStoriesResponse extends ToolResponse {
  output: {
    stories: Array<{
      id: string
      mediaType: string | null
      mediaUrl: string | null
      timestamp: string | null
    }>
    nextCursor: string | null
  }
}

/** Uploaded UserFile object, or a public HTTPS URL string (advanced paste / legacy). */
export type InstagramMediaInput = RawFileInput | string

export interface InstagramPublishImageParams extends InstagramAccessParams {
  image: InstagramMediaInput
  caption?: string
  altText?: string
  isAiGenerated?: boolean
}

export interface InstagramPublishVideoParams extends InstagramAccessParams {
  video: InstagramMediaInput
  caption?: string
  cover?: InstagramMediaInput
}

export interface InstagramPublishReelParams extends InstagramAccessParams {
  video: InstagramMediaInput
  caption?: string
  cover?: InstagramMediaInput
  shareToFeed?: boolean
  thumbOffset?: number
}

export interface InstagramPublishStoryParams extends InstagramAccessParams {
  media: InstagramMediaInput
}

export interface InstagramPublishCarouselParams extends InstagramAccessParams {
  /** File array, single file, or comma-separated public URLs (prefix videos with video:). */
  media: RawFileInput | RawFileInput[] | string
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
    recipientId: string | null
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
  limit?: number
  after?: string
}

export interface InstagramGetConversationMessagesResponse extends ToolResponse {
  output: {
    conversationId: string
    messages: Array<{
      id: string
      createdTime: string | null
      isUnsupported: boolean
    }>
    nextCursor: string | null
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

export type InstagramAccountInsightsPeriod = 'day' | 'lifetime'
export type InstagramAccountInsightsMetricType = 'time_series' | 'total_value'
export type InstagramAccountInsightsTimeframe = 'this_week' | 'this_month'

export interface InstagramGetAccountInsightsParams extends InstagramAccessParams {
  metrics: string
  period: InstagramAccountInsightsPeriod
  since?: string
  until?: string
  metricType?: InstagramAccountInsightsMetricType
  breakdown?: string
  timeframe?: InstagramAccountInsightsTimeframe
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
      title: string | null
      description: string | null
      values: unknown[]
      totalValue: unknown
    }>
  }
}

export type InstagramResponse =
  | InstagramGetProfileResponse
  | InstagramListMediaResponse
  | InstagramGetMediaResponse
  | InstagramDownloadMediaResponse
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
