import type { ToolResponse } from '@/tools/types'

/**
 * Base params that include OAuth access token
 */
export interface TikTokBaseParams {
  accessToken: string
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
    avatarUrl: string | null
    avatarUrl100: string | null
    avatarLargeUrl: string | null
    bioDescription: string | null
    profileDeepLink: string | null
    isVerified: boolean | null
    username: string | null
    followerCount: number | null
    followingCount: number | null
    likesCount: number | null
    videoCount: number | null
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
  duration: number | null
  createTime: number | null
  shareUrl: string | null
  videoDescription: string | null
  width: number | null
  height: number | null
}

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

/**
 * Query Creator Info - Check posting permissions and get privacy options
 */
export interface TikTokQueryCreatorInfoParams extends TikTokBaseParams {}

export interface TikTokQueryCreatorInfoResponse extends ToolResponse {
  output: {
    creatorAvatarUrl: string | null
    creatorUsername: string | null
    creatorNickname: string | null
    privacyLevelOptions: string[]
    commentDisabled: boolean
    duetDisabled: boolean
    stitchDisabled: boolean
    maxVideoPostDurationSec: number | null
  }
}

/**
 * Direct Post Video - Publish video from URL to TikTok
 */
export interface TikTokDirectPostVideoParams extends TikTokBaseParams {
  videoUrl: string
  title?: string
  privacyLevel: string
  disableDuet?: boolean
  disableStitch?: boolean
  disableComment?: boolean
  videoCoverTimestampMs?: number
  isAigc?: boolean
}

export interface TikTokDirectPostVideoResponse extends ToolResponse {
  output: {
    publishId: string
  }
}

/**
 * Get Post Status - Check status of a published post
 */
export interface TikTokGetPostStatusParams extends TikTokBaseParams {
  publishId: string
}

export interface TikTokGetPostStatusResponse extends ToolResponse {
  output: {
    status: string
    failReason: string | null
    publiclyAvailablePostId: string[]
  }
}

/**
 * Union type of all TikTok responses
 */
export type TikTokResponse =
  | TikTokGetUserResponse
  | TikTokListVideosResponse
  | TikTokQueryVideosResponse
  | TikTokQueryCreatorInfoResponse
  | TikTokDirectPostVideoResponse
  | TikTokGetPostStatusResponse
