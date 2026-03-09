import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyReorderPlaylistItemsParams {
  accessToken: string
  playlistId: string
  range_start: number
  insert_before: number
  range_length?: number
  snapshot_id?: string
}

interface SpotifyReorderPlaylistItemsResponse extends ToolResponse {
  output: {
    snapshot_id: string
  }
}

export const spotifyReorderPlaylistItemsTool: ToolConfig<
  SpotifyReorderPlaylistItemsParams,
  SpotifyReorderPlaylistItemsResponse
> = {
  id: 'spotify_reorder_playlist_items',
  name: 'Spotify Reorder Playlist Items',
  description: 'Move tracks to a different position in a playlist.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['playlist-modify-public', 'playlist-modify-private'],
  },

  params: {
    playlistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify playlist ID',
    },
    range_start: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start index of items to reorder',
    },
    insert_before: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Index to insert items before',
    },
    range_length: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 1,
      description: 'Number of items to reorder',
    },
    snapshot_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Playlist snapshot ID for concurrency control (22-character base62 string)',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/tracks`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        range_start: params.range_start,
        insert_before: params.insert_before,
        range_length: params.range_length || 1,
      }
      if (params.snapshot_id) body.snapshot_id = params.snapshot_id
      return body
    },
  },

  transformResponse: async (response): Promise<SpotifyReorderPlaylistItemsResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: { snapshot_id: data.snapshot_id || '' },
    }
  },

  outputs: {
    snapshot_id: { type: 'string', description: 'New playlist snapshot ID' },
  },
}
