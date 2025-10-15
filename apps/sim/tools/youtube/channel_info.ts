import type { ToolConfig } from '@/tools/types'
import type { YouTubeChannelInfoParams, YouTubeChannelInfoResponse } from '@/tools/youtube/types'

export const youtubeChannelInfoTool: ToolConfig<
  YouTubeChannelInfoParams,
  YouTubeChannelInfoResponse
> = {
  id: 'youtube_channel_info',
  name: 'YouTube Channel Info',
  description: 'Get detailed information about a YouTube channel.',
  version: '1.0.0',
  params: {
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'YouTube channel ID (use either channelId or username)',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'YouTube channel username (use either channelId or username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  request: {
    url: (params: YouTubeChannelInfoParams) => {
      let url =
        'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails'
      if (params.channelId) {
        url += `&id=${params.channelId}`
      } else if (params.username) {
        url += `&forUsername=${params.username}`
      }
      url += `&key=${params.apiKey}`
      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeChannelInfoResponse> => {
    const data = await response.json()

    if (!data.items || data.items.length === 0) {
      return {
        success: false,
        output: {
          channelId: '',
          title: '',
          description: '',
          subscriberCount: 0,
          videoCount: 0,
          viewCount: 0,
          publishedAt: '',
          thumbnail: '',
        },
        error: 'Channel not found',
      }
    }

    const item = data.items[0]
    return {
      success: true,
      output: {
        channelId: item.id,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        subscriberCount: Number(item.statistics?.subscriberCount || 0),
        videoCount: Number(item.statistics?.videoCount || 0),
        viewCount: Number(item.statistics?.viewCount || 0),
        publishedAt: item.snippet?.publishedAt || '',
        thumbnail:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          '',
        customUrl: item.snippet?.customUrl,
      },
    }
  },

  outputs: {
    channelId: {
      type: 'string',
      description: 'YouTube channel ID',
    },
    title: {
      type: 'string',
      description: 'Channel name',
    },
    description: {
      type: 'string',
      description: 'Channel description',
    },
    subscriberCount: {
      type: 'number',
      description: 'Number of subscribers',
    },
    videoCount: {
      type: 'number',
      description: 'Number of videos',
    },
    viewCount: {
      type: 'number',
      description: 'Total channel views',
    },
    publishedAt: {
      type: 'string',
      description: 'Channel creation date',
    },
    thumbnail: {
      type: 'string',
      description: 'Channel thumbnail URL',
    },
    customUrl: {
      type: 'string',
      description: 'Channel custom URL',
      optional: true,
    },
  },
}
