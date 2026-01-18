import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyCheckPlaylistFollowersParams {
  accessToken: string
  playlistId: string
  userIds: string
}

interface SpotifyCheckPlaylistFollowersResponse extends ToolResponse {
  output: { results: boolean[] }
}

export const spotifyCheckPlaylistFollowersTool: ToolConfig<
  SpotifyCheckPlaylistFollowersParams,
  SpotifyCheckPlaylistFollowersResponse
> = {
  id: 'spotify_check_playlist_followers',
  name: 'Spotify Check Playlist Followers',
  description: 'Check if users follow a playlist.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['playlist-read-private'],
  },

  params: {
    playlistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify playlist ID',
    },
    userIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs to check (max 5)',
    },
  },

  request: {
    url: (params) => {
      const ids = params.userIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 5)
        .join(',')
      return `https://api.spotify.com/v1/playlists/${params.playlistId}/followers/contains?ids=${ids}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyCheckPlaylistFollowersResponse> => {
    const results = await response.json()
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each user' },
  },
}
