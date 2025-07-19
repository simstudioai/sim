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
