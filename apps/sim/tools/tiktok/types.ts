import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/**
 * Base params that include OAuth access token
 */
export interface TikTokBaseParams {
  accessToken: string
}

/** Error envelope returned by TikTok APIs. */
export interface TikTokApiError {
  code: string
  message?: string
  logId?: string
}

/**
 * Get User Info
 */
export interface TikTokGetUserParams extends TikTokBaseParams {
  fields?: string
}

export interface TikTokGetUserResponse extends ToolResponse {
  output: {
    openId: string
    unionId: string | null
    displayName: string
    bioDescription: string | null
    profileDeepLink: string | null
    isVerified: boolean | null
    username: string | null
    followerCount: number | null
    followingCount: number | null
    likesCount: number | null
    videoCount: number | null
    avatarFile?: ToolFileData
  }
}

/**
 * List Videos
 */
export interface TikTokListVideosParams extends TikTokBaseParams {
  maxCount?: number
  cursor?: number
}

export interface TikTokVideo {
  id: string
  title: string | null
  coverImageUrl: string | null
  embedLink: string | null
  embedHtml: string | null
  duration: number | null
  createTime: number | null
  shareUrl: string | null
  videoDescription: string | null
  width: number | null
  height: number | null
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  shareCount: number | null
}

/**
 * Shared output schema for video objects returned by list and query tools.
 * Lives in types.ts so the docs generator can resolve the const reference.
 */
export const TIKTOK_VIDEO_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Video ID' },
  title: { type: 'string', description: 'Video title', optional: true },
  coverImageUrl: {
    type: 'string',
    description:
      'Signed TikTok CDN cover URL. It is public but time-limited, so consume it immediately.',
    optional: true,
  },
  embedLink: { type: 'string', description: 'Embeddable video URL', optional: true },
  embedHtml: { type: 'string', description: 'HTML embed markup for the video', optional: true },
  duration: { type: 'number', description: 'Video duration in seconds', optional: true },
  createTime: {
    type: 'number',
    description: 'Unix timestamp when the video was created',
    optional: true,
  },
  shareUrl: { type: 'string', description: 'Shareable video URL', optional: true },
  videoDescription: {
    type: 'string',
    description: 'Video description or caption',
    optional: true,
  },
  width: { type: 'number', description: 'Video width in pixels', optional: true },
  height: { type: 'number', description: 'Video height in pixels', optional: true },
  viewCount: { type: 'number', description: 'Number of views', optional: true },
  likeCount: { type: 'number', description: 'Number of likes', optional: true },
  commentCount: { type: 'number', description: 'Number of comments', optional: true },
  shareCount: { type: 'number', description: 'Number of shares', optional: true },
} satisfies Record<keyof TikTokVideo, OutputProperty>

export interface TikTokListVideosResponse extends ToolResponse {
  output: {
    videos: TikTokVideo[]
    cursor: number | null
    hasMore: boolean
  }
}

/**
 * Query Videos
 */
export interface TikTokQueryVideosParams extends TikTokBaseParams {
  videoIds: string[]
}

export interface TikTokQueryVideosResponse extends ToolResponse {
  output: {
    videos: TikTokVideo[]
  }
}

/** Response shape for TikTok inbox draft initialization. */
export interface TikTokDraftInitResponse extends ToolResponse {
  output: {
    publishId: string
  }
}

/**
 * Upload Video Draft - Send a video to the user's TikTok inbox for manual editing/posting
 */
export interface TikTokUploadVideoDraftParams extends TikTokBaseParams {
  file: UserFile
}

export type TikTokUploadVideoDraftResponse = TikTokDraftInitResponse

/**
 * Get Post Status - Check status of a published/uploaded post
 */
export interface TikTokGetPostStatusParams extends TikTokBaseParams {
  publishId: string
}

export interface TikTokGetPostStatusResponse extends ToolResponse {
  output: {
    status: string
    failReason: string | null
    publiclyAvailablePostId: string[]
    uploadedBytes: number | null
    downloadedBytes: number | null
  }
}

/**
 * Union type of all TikTok responses
 */
export type TikTokResponse =
  | TikTokGetUserResponse
  | TikTokListVideosResponse
  | TikTokQueryVideosResponse
  | TikTokUploadVideoDraftResponse
  | TikTokGetPostStatusResponse
