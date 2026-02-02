import type { ToolConfig } from '@/tools/types'
import type { YouTubeChannelInfoParams, YouTubeChannelInfoResponse } from '@/tools/youtube/types'

export const youtubeChannelInfoTool: ToolConfig<
  YouTubeChannelInfoParams,
  YouTubeChannelInfoResponse
> = {
  id: 'youtube_channel_info',
  name: 'YouTube Channel Info',
  description:
    'Get detailed information about a YouTube channel including statistics, branding, and content details.',
  version: '1.1.0',
  params: {
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'YouTube channel ID starting with "UC" (24-character string, use either channelId or username)',
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
        'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails,brandingSettings'
      if (params.channelId) {
        url += `&id=${encodeURIComponent(params.channelId)}`
      } else if (params.username) {
        url += `&forUsername=${encodeURIComponent(params.username)}`
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
          customUrl: null,
          country: null,
          uploadsPlaylistId: null,
          bannerImageUrl: null,
          hiddenSubscriberCount: false,
        },
        error: 'Channel not found',
      }
    }

    const item = data.items[0]
    return {
      success: true,
      output: {
        channelId: item.id ?? '',
        title: item.snippet?.title ?? '',
        description: item.snippet?.description ?? '',
        subscriberCount: Number(item.statistics?.subscriberCount || 0),
        videoCount: Number(item.statistics?.videoCount || 0),
        viewCount: Number(item.statistics?.viewCount || 0),
        publishedAt: item.snippet?.publishedAt ?? '',
        thumbnail:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          '',
        customUrl: item.snippet?.customUrl ?? null,
        country: item.snippet?.country ?? null,
        uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
        bannerImageUrl: item.brandingSettings?.image?.bannerExternalUrl ?? null,
        hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount ?? false,
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
      description: 'Number of subscribers (0 if hidden)',
    },
    videoCount: {
      type: 'number',
      description: 'Number of public videos',
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
      description: 'Channel thumbnail/avatar URL',
    },
    customUrl: {
      type: 'string',
      description: 'Channel custom URL (handle)',
      optional: true,
    },
    country: {
      type: 'string',
      description: 'Country the channel is associated with',
      optional: true,
    },
    uploadsPlaylistId: {
      type: 'string',
      description: 'Playlist ID containing all channel uploads (use with playlist_items)',
      optional: true,
    },
    bannerImageUrl: {
      type: 'string',
      description: 'Channel banner image URL',
      optional: true,
    },
    hiddenSubscriberCount: {
      type: 'boolean',
      description: 'Whether the subscriber count is hidden',
    },
  },
}
