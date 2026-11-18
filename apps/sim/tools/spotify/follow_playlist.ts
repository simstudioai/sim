import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyFollowPlaylistParams {
  accessToken: string
  playlistId: string
  public?: boolean
}

interface SpotifyFollowPlaylistResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyFollowPlaylistTool: ToolConfig<
  SpotifyFollowPlaylistParams,
  SpotifyFollowPlaylistResponse
> = {
  id: 'spotify_follow_playlist',
  name: 'Spotify Follow Playlist',
  description: 'Follow (save) a playlist.',
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
    public: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: true,
      description: 'Whether the playlist will appear in public playlists',
    },
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/followers`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      public: params.public ?? true,
    }),
  },

  transformResponse: async (): Promise<SpotifyFollowPlaylistResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether follow succeeded' },
  },
}
