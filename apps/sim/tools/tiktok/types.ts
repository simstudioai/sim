import type { UserFile } from '@/executor/types'
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
    bioDescription: string | null
    profileDeepLink: string | null
    isVerified: boolean | null
    username: string | null
    followerCount: number | null
    followingCount: number | null
    likesCount: number | null
    videoCount: number | null
    avatarFile?: {
      name: string
      mimeType: string
      url: string
    }
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
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  shareCount: number | null
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
 * Shared media transfer source for video operations
 */
export type TikTokVideoSource = 'PULL_FROM_URL' | 'FILE_UPLOAD'

/**
 * Direct Post Video - Publish video (by URL or uploaded file) to TikTok
 */
export interface TikTokDirectPostVideoParams extends TikTokBaseParams {
  source: TikTokVideoSource
  videoUrl?: string
  file?: UserFile
  title?: string
  privacyLevel: string
  disableDuet?: boolean
  disableStitch?: boolean
  disableComment?: boolean
  videoCoverTimestampMs?: number
  isAigc?: boolean
  brandContentToggle?: boolean
  brandOrganicToggle?: boolean
}

export interface TikTokDirectPostVideoResponse extends ToolResponse {
  output: {
    publishId: string
  }
}

/**
 * Upload Video Draft - Send a video to the user's TikTok inbox for manual editing/posting
 */
export interface TikTokUploadVideoDraftParams extends TikTokBaseParams {
  source: TikTokVideoSource
  videoUrl?: string
  file?: UserFile
}

export interface TikTokUploadVideoDraftResponse extends ToolResponse {
  output: {
    publishId: string
  }
}

/**
 * Direct Post Photo - Publish photo(s) from public URLs to TikTok
 */
export interface TikTokDirectPostPhotoParams extends TikTokBaseParams {
  photoImages: string[]
  photoCoverIndex?: number
  title?: string
  description?: string
  privacyLevel: string
  disableComment?: boolean
  autoAddMusic?: boolean
  brandContentToggle?: boolean
  brandOrganicToggle?: boolean
}

export interface TikTokDirectPostPhotoResponse extends ToolResponse {
  output: {
    publishId: string
  }
}

/**
 * Upload Photo Draft - Send photo(s) to the user's TikTok inbox for manual editing/posting
 */
export interface TikTokUploadPhotoDraftParams extends TikTokBaseParams {
  photoImages: string[]
  photoCoverIndex?: number
  title?: string
  description?: string
}

export interface TikTokUploadPhotoDraftResponse extends ToolResponse {
  output: {
    publishId: string
  }
}

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
  | TikTokUploadVideoDraftResponse
  | TikTokDirectPostPhotoResponse
  | TikTokUploadPhotoDraftResponse
  | TikTokGetPostStatusResponse
