import type { ToolConfig } from '@/tools/types'
import type { YouTubeTrendingParams, YouTubeTrendingResponse } from '@/tools/youtube/types'

export const youtubeTrendingTool: ToolConfig<YouTubeTrendingParams, YouTubeTrendingResponse> = {
  id: 'youtube_trending',
  name: 'YouTube Trending Videos',
  description:
    'Get the most popular/trending videos on YouTube. Can filter by region and video category.',
  version: '1.0.0',
  params: {
    regionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO 3166-1 alpha-2 country code to get trending videos for (e.g., "US", "GB", "JP"). Defaults to US.',
    },
    videoCategoryId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by video category ID (e.g., "10" for Music, "20" for Gaming, "17" for Sports)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 10,
      description: 'Maximum number of trending videos to return (1-50)',
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
  },

  request: {
    url: (params: YouTubeTrendingParams) => {
      let url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
      url += `&regionCode=${params.regionCode || 'US'}`
      if (params.videoCategoryId) {
        url += `&videoCategoryId=${params.videoCategoryId}`
      }
      if (params.pageToken) {
        url += `&pageToken=${encodeURIComponent(params.pageToken)}`
      }
      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeTrendingResponse> => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
          nextPageToken: null,
        },
        error: data.error.message || 'Failed to fetch trending videos',
      }
    }

    const items = (data.items || []).map((item: any) => ({
      videoId: item.id ?? '',
      title: item.snippet?.title ?? '',
      description: item.snippet?.description ?? '',
      thumbnail:
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        '',
      channelId: item.snippet?.channelId ?? '',
      channelTitle: item.snippet?.channelTitle ?? '',
      publishedAt: item.snippet?.publishedAt ?? '',
      viewCount: Number(item.statistics?.viewCount || 0),
      likeCount: Number(item.statistics?.likeCount || 0),
      commentCount: Number(item.statistics?.commentCount || 0),
      duration: item.contentDetails?.duration ?? '',
    }))

    return {
      success: true,
      output: {
        items,
        totalResults: data.pageInfo?.totalResults || items.length,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of trending videos',
      items: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'YouTube video ID' },
          title: { type: 'string', description: 'Video title' },
          description: { type: 'string', description: 'Video description' },
          thumbnail: { type: 'string', description: 'Video thumbnail URL' },
          channelId: { type: 'string', description: 'Channel ID' },
          channelTitle: { type: 'string', description: 'Channel name' },
          publishedAt: { type: 'string', description: 'Video publish date' },
          viewCount: { type: 'number', description: 'Number of views' },
          likeCount: { type: 'number', description: 'Number of likes' },
          commentCount: { type: 'number', description: 'Number of comments' },
          duration: { type: 'string', description: 'Video duration in ISO 8601 format' },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of trending videos available',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },
}
