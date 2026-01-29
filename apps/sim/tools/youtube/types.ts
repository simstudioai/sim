import type { ToolResponse } from '@/tools/types'

export interface YouTubeSearchParams {
  apiKey: string
  query: string
  maxResults?: number
  pageToken?: string
  channelId?: string
  publishedAfter?: string
  publishedBefore?: string
  videoDuration?: 'any' | 'short' | 'medium' | 'long'
  order?: 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount'
  videoCategoryId?: string
  videoDefinition?: 'any' | 'high' | 'standard'
  videoCaption?: 'any' | 'closedCaption' | 'none'
  regionCode?: string
  relevanceLanguage?: string
  safeSearch?: 'moderate' | 'none' | 'strict'
  eventType?: 'completed' | 'live' | 'upcoming'
}

export interface YouTubeSearchResponse extends ToolResponse {
  output: {
    items: Array<{
      videoId: string
      title: string
      description: string
      thumbnail: string
      channelId: string
      channelTitle: string
      publishedAt: string
      liveBroadcastContent: string
    }>
    totalResults: number
    nextPageToken?: string | null
  }
}

export interface YouTubeVideoDetailsParams {
  apiKey: string
  videoId: string
}

export interface YouTubeVideoDetailsResponse extends ToolResponse {
  output: {
    videoId: string
    title: string
    description: string
    channelId: string
    channelTitle: string
    publishedAt: string
    duration: string
    viewCount: number
    likeCount: number
    commentCount: number
    favoriteCount: number
    thumbnail: string
    tags: string[]
    categoryId: string | null
    definition: string | null
    caption: string | null
    licensedContent: boolean | null
    privacyStatus: string | null
    liveBroadcastContent: string | null
    defaultLanguage: string | null
    defaultAudioLanguage: string | null
    // Live streaming details
    isLiveContent: boolean
    scheduledStartTime: string | null
    actualStartTime: string | null
    actualEndTime: string | null
    concurrentViewers: number | null
    activeLiveChatId: string | null
  }
}

export interface YouTubeChannelInfoParams {
  apiKey: string
  channelId?: string
  username?: string
}

export interface YouTubeChannelInfoResponse extends ToolResponse {
  output: {
    channelId: string
    title: string
    description: string
    subscriberCount: number
    videoCount: number
    viewCount: number
    publishedAt: string
    thumbnail: string
    customUrl: string | null
    country: string | null
    uploadsPlaylistId: string | null
    bannerImageUrl: string | null
    hiddenSubscriberCount: boolean
  }
}

export interface YouTubePlaylistItemsParams {
  apiKey: string
  playlistId: string
  maxResults?: number
  pageToken?: string
}

export interface YouTubePlaylistItemsResponse extends ToolResponse {
  output: {
    items: Array<{
      videoId: string
      title: string
      description: string
      thumbnail: string
      publishedAt: string
      channelTitle: string
      position: number
      videoOwnerChannelId: string | null
      videoOwnerChannelTitle: string | null
    }>
    totalResults: number
    nextPageToken?: string | null
  }
}

export interface YouTubeCommentsParams {
  apiKey: string
  videoId: string
  maxResults?: number
  order?: 'time' | 'relevance'
  pageToken?: string
}

export interface YouTubeCommentsResponse extends ToolResponse {
  output: {
    items: Array<{
      commentId: string
      authorDisplayName: string
      authorChannelUrl: string
      authorProfileImageUrl: string
      textDisplay: string
      textOriginal: string
      likeCount: number
      publishedAt: string
      updatedAt: string
      replyCount: number
    }>
    totalResults: number
    nextPageToken?: string | null
  }
}

export interface YouTubeChannelVideosParams {
  apiKey: string
  channelId: string
  maxResults?: number
  order?: 'date' | 'rating' | 'relevance' | 'title' | 'viewCount'
  pageToken?: string
}

export interface YouTubeChannelVideosResponse extends ToolResponse {
  output: {
    items: Array<{
      videoId: string
      title: string
      description: string
      thumbnail: string
      publishedAt: string
      channelTitle: string
    }>
    totalResults: number
    nextPageToken?: string | null
  }
}

export interface YouTubeChannelPlaylistsParams {
  apiKey: string
  channelId: string
  maxResults?: number
  pageToken?: string
}

export interface YouTubeChannelPlaylistsResponse extends ToolResponse {
  output: {
    items: Array<{
      playlistId: string
      title: string
      description: string
      thumbnail: string
      itemCount: number
      publishedAt: string
      channelTitle: string
    }>
    totalResults: number
    nextPageToken?: string | null
  }
}

export interface YouTubeTrendingParams {
  apiKey: string
  regionCode?: string
  videoCategoryId?: string
  maxResults?: number
  pageToken?: string
}

export interface YouTubeTrendingResponse extends ToolResponse {
  output: {
    items: Array<{
      videoId: string
      title: string
      description: string
      thumbnail: string
      channelId: string
      channelTitle: string
      publishedAt: string
      viewCount: number
      likeCount: number
      commentCount: number
      duration: string
    }>
    totalResults: number
    nextPageToken?: string | null
  }
}

export interface YouTubeVideoCategoriesParams {
  apiKey: string
  regionCode?: string
  hl?: string
}

export interface YouTubeVideoCategoriesResponse extends ToolResponse {
  output: {
    items: Array<{
      categoryId: string
      title: string
      assignable: boolean
    }>
    totalResults: number
  }
}

export type YouTubeResponse =
  | YouTubeSearchResponse
  | YouTubeVideoDetailsResponse
  | YouTubeChannelInfoResponse
  | YouTubePlaylistItemsResponse
  | YouTubeCommentsResponse
  | YouTubeChannelVideosResponse
  | YouTubeChannelPlaylistsResponse
  | YouTubeTrendingResponse
  | YouTubeVideoCategoriesResponse
