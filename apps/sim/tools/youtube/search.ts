import type { ToolConfig } from '@/tools/types'
import type { YouTubeSearchParams, YouTubeSearchResponse } from '@/tools/youtube/types'

export const youtubeSearchTool: ToolConfig<YouTubeSearchParams, YouTubeSearchResponse> = {
  id: 'youtube_search',
  name: 'YouTube Search',
  description: 'Search for videos on YouTube using the YouTube Data API.',
  version: '1.0.0',
  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query for YouTube videos',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      default: 5,
      description: 'Maximum number of videos to return',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of YouTube videos matching the search query',
      items: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'YouTube video ID' },
          title: { type: 'string', description: 'Video title' },
          description: { type: 'string', description: 'Video description' },
          thumbnail: { type: 'string', description: 'Video thumbnail URL' },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of search results available',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },

  request: {
    url: (params: YouTubeSearchParams) => {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&key=${params.apiKey}&q=${encodeURIComponent(
        params.query
      )}`
      url += `&maxResults=${params.maxResults || 5}`
      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response: Response): Promise<YouTubeSearchResponse> => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'YouTube API error')
    }
    const items = (data.items || []).map((item: any) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      thumbnail:
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
    }))
    return {
      success: true,
      output: {
        items,
        totalResults: data.pageInfo?.totalResults || 0,
        nextPageToken: data.nextPageToken,
      },
    }
  },
  transformError: (error: any): string => {
    const message = error.error?.message || error.message || 'YouTube search failed'
    const code = error.error?.code || error.code
    return `${message} (${code})`
  },
}
