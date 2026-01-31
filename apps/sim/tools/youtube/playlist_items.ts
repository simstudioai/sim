import type { ToolConfig } from '@/tools/types'
import type {
  YouTubePlaylistItemsParams,
  YouTubePlaylistItemsResponse,
} from '@/tools/youtube/types'

export const youtubePlaylistItemsTool: ToolConfig<
  YouTubePlaylistItemsParams,
  YouTubePlaylistItemsResponse
> = {
  id: 'youtube_playlist_items',
  name: 'YouTube Playlist Items',
  description:
    'Get videos from a YouTube playlist. Can be used with a channel uploads playlist to get all channel videos.',
  version: '1.1.0',
  params: {
    playlistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'YouTube playlist ID starting with "PL" or "UU" (34-character string). Use uploadsPlaylistId from channel_info to get all channel videos.',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 10,
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
  },

  request: {
    url: (params: YouTubePlaylistItemsParams) => {
      let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(params.playlistId)}&key=${params.apiKey}`
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

  transformResponse: async (response: Response): Promise<YouTubePlaylistItemsResponse> => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
          nextPageToken: null,
        },
        error: data.error.message || 'Failed to fetch playlist items',
      }
    }

    const items = (data.items || []).map((item: any, index: number) => ({
      videoId: item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId ?? '',
      title: item.snippet?.title ?? '',
      description: item.snippet?.description ?? '',
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        item.snippet?.thumbnails?.high?.url ||
        '',
      publishedAt: item.snippet?.publishedAt ?? '',
      channelTitle: item.snippet?.channelTitle ?? '',
      position: item.snippet?.position ?? index,
      videoOwnerChannelId: item.snippet?.videoOwnerChannelId ?? null,
      videoOwnerChannelTitle: item.snippet?.videoOwnerChannelTitle ?? null,
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
      description: 'Array of videos in the playlist',
      items: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'YouTube video ID' },
          title: { type: 'string', description: 'Video title' },
          description: { type: 'string', description: 'Video description' },
          thumbnail: { type: 'string', description: 'Video thumbnail URL' },
          publishedAt: { type: 'string', description: 'Date added to playlist' },
          channelTitle: { type: 'string', description: 'Playlist owner channel name' },
          position: { type: 'number', description: 'Position in playlist (0-indexed)' },
          videoOwnerChannelId: {
            type: 'string',
            description: 'Channel ID of the video owner',
            optional: true,
          },
          videoOwnerChannelTitle: {
            type: 'string',
            description: 'Channel name of the video owner',
            optional: true,
          },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of items in playlist',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },
}
