import type { ToolConfig } from '@/tools/types'
import type { YouTubeSearchParams, YouTubeSearchResponse } from '@/tools/youtube/types'

export const youtubeSearchTool: ToolConfig<YouTubeSearchParams, YouTubeSearchResponse> = {
  id: 'youtube_search',
  name: 'YouTube Search',
  description:
    'Search for videos on YouTube using the YouTube Data API. Supports advanced filtering by channel, date range, duration, category, quality, captions, live streams, and more.',
  version: '1.2.0',
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
      visibility: 'user-or-llm',
      default: 5,
      description: 'Maximum number of videos to return (1-50)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token for pagination (from previous response nextPageToken)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter results to a specific YouTube channel ID starting with "UC" (24-character string)',
    },
    publishedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return videos published after this date (RFC 3339 format: "2024-01-01T00:00:00Z")',
    },
    publishedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return videos published before this date (RFC 3339 format: "2024-01-01T00:00:00Z")',
    },
    videoDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by video length: "short" (<4 min), "medium" (4-20 min), "long" (>20 min), "any"',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort results by: "date", "rating", "relevance" (default), "title", "videoCount", "viewCount"',
    },
    videoCategoryId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by YouTube category ID (e.g., "10" for Music, "20" for Gaming). Use video_categories to list IDs.',
    },
    videoDefinition: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by video quality: "high" (HD), "standard", "any"',
    },
    videoCaption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by caption availability: "closedCaption" (has captions), "none" (no captions), "any"',
    },
    eventType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by live broadcast status: "live" (currently live), "upcoming" (scheduled), "completed" (past streams)',
    },
    regionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return results relevant to a specific region (ISO 3166-1 alpha-2 country code, e.g., "US", "GB")',
    },
    relevanceLanguage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return results most relevant to a language (ISO 639-1 code, e.g., "en", "es")',
    },
    safeSearch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content filtering level: "moderate" (default), "none", "strict"',
    },
  },

  request: {
    url: (params: YouTubeSearchParams) => {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&key=${params.apiKey}&q=${encodeURIComponent(
        params.query
      )}`
      url += `&maxResults=${Number(params.maxResults || 5)}`

      if (params.pageToken) {
        url += `&pageToken=${encodeURIComponent(params.pageToken)}`
      }
      if (params.channelId) {
        url += `&channelId=${encodeURIComponent(params.channelId)}`
      }
      if (params.publishedAfter) {
        url += `&publishedAfter=${encodeURIComponent(params.publishedAfter)}`
      }
      if (params.publishedBefore) {
        url += `&publishedBefore=${encodeURIComponent(params.publishedBefore)}`
      }
      if (params.videoDuration) {
        url += `&videoDuration=${params.videoDuration}`
      }
      if (params.order) {
        url += `&order=${params.order}`
      }
      if (params.videoCategoryId) {
        url += `&videoCategoryId=${params.videoCategoryId}`
      }
      if (params.videoDefinition) {
        url += `&videoDefinition=${params.videoDefinition}`
      }
      if (params.videoCaption) {
        url += `&videoCaption=${params.videoCaption}`
      }
      if (params.eventType) {
        url += `&eventType=${params.eventType}`
      }
      if (params.regionCode) {
        url += `&regionCode=${params.regionCode}`
      }
      if (params.relevanceLanguage) {
        url += `&relevanceLanguage=${params.relevanceLanguage}`
      }
      if (params.safeSearch) {
        url += `&safeSearch=${params.safeSearch}`
      }

      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeSearchResponse> => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
          nextPageToken: null,
        },
        error: data.error.message || 'Search failed',
      }
    }

    const items = (data.items || []).map((item: any) => ({
      videoId: item.id?.videoId ?? '',
      title: item.snippet?.title ?? '',
      description: item.snippet?.description ?? '',
      thumbnail:
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
      channelId: item.snippet?.channelId ?? '',
      channelTitle: item.snippet?.channelTitle ?? '',
      publishedAt: item.snippet?.publishedAt ?? '',
      liveBroadcastContent: item.snippet?.liveBroadcastContent ?? 'none',
    }))
    return {
      success: true,
      output: {
        items,
        totalResults: data.pageInfo?.totalResults || 0,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
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
          channelId: { type: 'string', description: 'Channel ID that uploaded the video' },
          channelTitle: { type: 'string', description: 'Channel name' },
          publishedAt: { type: 'string', description: 'Video publish date' },
          liveBroadcastContent: {
            type: 'string',
            description: 'Live broadcast status: "none", "live", or "upcoming"',
          },
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
}
