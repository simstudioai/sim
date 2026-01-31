import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyUpdatePlaylistParams {
  accessToken: string
  playlistId: string
  name?: string
  description?: string
  public?: boolean
}

interface SpotifyUpdatePlaylistResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyUpdatePlaylistTool: ToolConfig<
  SpotifyUpdatePlaylistParams,
  SpotifyUpdatePlaylistResponse
> = {
  id: 'spotify_update_playlist',
  name: 'Spotify Update Playlist',
  description: "Update a playlist's name, description, or visibility.",
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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the playlist',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the playlist',
    },
    public: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the playlist should be public',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.name !== undefined) body.name = params.name
      if (params.description !== undefined) body.description = params.description
      if (params.public !== undefined) body.public = params.public
      return body
    },
  },

  transformResponse: async (): Promise<SpotifyUpdatePlaylistResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether update succeeded' },
  },
}
