import type { ToolConfig } from '@/tools/types'
import type {
  YouTubeChannelVideosParams,
  YouTubeChannelVideosResponse,
} from '@/tools/youtube/types'

export const youtubeChannelVideosTool: ToolConfig<
  YouTubeChannelVideosParams,
  YouTubeChannelVideosResponse
> = {
  id: 'youtube_channel_videos',
  name: 'YouTube Channel Videos',
  description: 'Get all videos from a specific YouTube channel, with sorting options.',
  version: '1.0.0',
  params: {
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube channel ID to get videos from',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      default: 10,
      description: 'Maximum number of videos to return (1-50)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "date" (newest first), "rating", "relevance", "title", "viewCount"',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page token for pagination',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  request: {
    url: (params: YouTubeChannelVideosParams) => {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&channelId=${encodeURIComponent(
        params.channelId
      )}&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
      if (params.order) {
        url += `&order=${params.order}`
      }
      if (params.pageToken) {
        url += `&pageToken=${params.pageToken}`
      }
      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeChannelVideosResponse> => {
    const data = await response.json()
    const items = (data.items || []).map((item: any) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
      publishedAt: item.snippet?.publishedAt || '',
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

  outputs: {
    items: {
      type: 'array',
      description: 'Array of videos from the channel',
      items: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'YouTube video ID' },
          title: { type: 'string', description: 'Video title' },
          description: { type: 'string', description: 'Video description' },
          thumbnail: { type: 'string', description: 'Video thumbnail URL' },
          publishedAt: { type: 'string', description: 'Video publish date' },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of videos in the channel',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },
}
