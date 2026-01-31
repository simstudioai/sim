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
  description:
    'Search for videos from a specific YouTube channel with sorting options. For complete channel video list, use channel_info to get uploadsPlaylistId, then use playlist_items.',
  version: '1.1.0',
  params: {
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube channel ID starting with "UC" (24-character string) to get videos from',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 10,
      description: 'Maximum number of videos to return (1-50)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order: "date" (newest first, default), "rating", "relevance", "title", "viewCount"',
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
    url: (params: YouTubeChannelVideosParams) => {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&channelId=${encodeURIComponent(
        params.channelId
      )}&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
      url += `&order=${params.order || 'date'}`
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

  transformResponse: async (response: Response): Promise<YouTubeChannelVideosResponse> => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
          nextPageToken: null,
        },
        error: data.error.message || 'Failed to fetch channel videos',
      }
    }

    const items = (data.items || []).map((item: any) => ({
      videoId: item.id?.videoId ?? '',
      title: item.snippet?.title ?? '',
      description: item.snippet?.description ?? '',
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
      publishedAt: item.snippet?.publishedAt ?? '',
      channelTitle: item.snippet?.channelTitle ?? '',
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
      description: 'Array of videos from the channel',
      items: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'YouTube video ID' },
          title: { type: 'string', description: 'Video title' },
          description: { type: 'string', description: 'Video description' },
          thumbnail: { type: 'string', description: 'Video thumbnail URL' },
          publishedAt: { type: 'string', description: 'Video publish date' },
          channelTitle: { type: 'string', description: 'Channel name' },
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
