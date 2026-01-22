import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyReplacePlaylistItemsParams {
  accessToken: string
  playlistId: string
  uris: string
}

interface SpotifyReplacePlaylistItemsResponse extends ToolResponse {
  output: {
    snapshot_id: string
  }
}

export const spotifyReplacePlaylistItemsTool: ToolConfig<
  SpotifyReplacePlaylistItemsParams,
  SpotifyReplacePlaylistItemsResponse
> = {
  id: 'spotify_replace_playlist_items',
  name: 'Spotify Replace Playlist Items',
  description: 'Replace all items in a playlist with new tracks.',
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
    uris: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated Spotify URIs (max 100)',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/tracks`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      uris: params.uris
        .split(',')
        .map((uri) => uri.trim())
        .slice(0, 100),
    }),
  },

  transformResponse: async (response): Promise<SpotifyReplacePlaylistItemsResponse> => {
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
