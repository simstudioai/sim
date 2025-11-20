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
  description: 'Get all playlists from a specific YouTube channel.',
  version: '1.0.0',
  params: {
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube channel ID to get playlists from',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      default: 10,
      description: 'Maximum number of playlists to return (1-50)',
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
    url: (params: YouTubeChannelPlaylistsParams) => {
      let url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(
        params.channelId
      )}&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
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

  transformResponse: async (response: Response): Promise<YouTubeChannelPlaylistsResponse> => {
    const data = await response.json()

    if (!data.items) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
        },
        error: 'No playlists found',
      }
    }

    const items = (data.items || []).map((item: any) => ({
      playlistId: item.id,
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
      itemCount: item.contentDetails?.itemCount || 0,
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
