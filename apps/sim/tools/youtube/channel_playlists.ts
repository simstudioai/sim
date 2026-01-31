import type { ToolConfig } from '@/tools/types'
import type {
  YouTubeChannelPlaylistsParams,
  YouTubeChannelPlaylistsResponse,
} from '@/tools/youtube/types'

export const youtubeChannelPlaylistsTool: ToolConfig<
  YouTubeChannelPlaylistsParams,
  YouTubeChannelPlaylistsResponse
> = {
  id: 'youtube_channel_playlists',
  name: 'YouTube Channel Playlists',
  description: 'Get all public playlists from a specific YouTube channel.',
  version: '1.1.0',
  params: {
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'YouTube channel ID starting with "UC" (24-character string) to get playlists from',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 10,
      description: 'Maximum number of playlists to return (1-50)',
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
    url: (params: YouTubeChannelPlaylistsParams) => {
      let url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(
        params.channelId
      )}&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
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

  transformResponse: async (response: Response): Promise<YouTubeChannelPlaylistsResponse> => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
          nextPageToken: null,
        },
        error: data.error.message || 'Failed to fetch channel playlists',
      }
    }

    if (!data.items || data.items.length === 0) {
      return {
        success: true,
        output: {
          items: [],
          totalResults: 0,
          nextPageToken: null,
        },
      }
    }

    const items = (data.items || []).map((item: any) => ({
      playlistId: item.id ?? '',
      title: item.snippet?.title ?? '',
      description: item.snippet?.description ?? '',
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
      itemCount: Number(item.contentDetails?.itemCount || 0),
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
      description: 'Array of playlists from the channel',
      items: {
        type: 'object',
        properties: {
          playlistId: { type: 'string', description: 'YouTube playlist ID' },
          title: { type: 'string', description: 'Playlist title' },
          description: { type: 'string', description: 'Playlist description' },
          thumbnail: { type: 'string', description: 'Playlist thumbnail URL' },
          itemCount: { type: 'number', description: 'Number of videos in playlist' },
          publishedAt: { type: 'string', description: 'Playlist creation date' },
          channelTitle: { type: 'string', description: 'Channel name' },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of playlists in the channel',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },
}
