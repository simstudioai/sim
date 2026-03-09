import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyUnfollowPlaylistParams {
  accessToken: string
  playlistId: string
}

interface SpotifyUnfollowPlaylistResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyUnfollowPlaylistTool: ToolConfig<
  SpotifyUnfollowPlaylistParams,
  SpotifyUnfollowPlaylistResponse
> = {
  id: 'spotify_unfollow_playlist',
  name: 'Spotify Unfollow Playlist',
  description: 'Unfollow (unsave) a playlist.',
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
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/playlists/${params.playlistId}/followers`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifyUnfollowPlaylistResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether unfollow succeeded' },
  },
}
