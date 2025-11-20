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
}

export interface YouTubeSearchResponse extends ToolResponse {
  output: {
    items: Array<{
      videoId: string
      title: string
      description: string
      thumbnail: string
    }>
    totalResults: number
    nextPageToken?: string
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
    thumbnail: string
    tags?: string[]
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
    customUrl?: string
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
    }>
    totalResults: number
    nextPageToken?: string
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
      textDisplay: string
      textOriginal: string
      likeCount: number
      publishedAt: string
      updatedAt: string
      replyCount?: number
    }>
    totalResults: number
    nextPageToken?: string
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
    }>
    totalResults: number
    nextPageToken?: string
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
    }>
    totalResults: number
    nextPageToken?: string
  }
}

export interface YouTubeRelatedVideosParams {
  apiKey: string
  videoId: string
  maxResults?: number
  pageToken?: string
}

export interface YouTubeRelatedVideosResponse extends ToolResponse {
  output: {
    items: Array<{
      videoId: string
      title: string
      description: string
      thumbnail: string
      channelTitle: string
    }>
    totalResults: number
    nextPageToken?: string
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
  | YouTubeRelatedVideosResponse
