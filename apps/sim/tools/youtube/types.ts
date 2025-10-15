import type { ToolResponse } from '@/tools/types'

export interface YouTubeSearchParams {
  apiKey: string
  query: string
  maxResults?: number
  pageToken?: string
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

export type YouTubeResponse =
  | YouTubeSearchResponse
  | YouTubeVideoDetailsResponse
  | YouTubeChannelInfoResponse
  | YouTubePlaylistItemsResponse
  | YouTubeCommentsResponse
