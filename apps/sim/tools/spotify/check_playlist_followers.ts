import { spotifyLibraryUrl } from '@/tools/spotify/utils'
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
  description: 'Check if the current user follows a playlist.',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Not used: Spotify only checks whether the current user follows the playlist, whatever IDs are given',
    },
  },

  request: {
    url: (params) => spotifyLibraryUrl(params.playlistId, 'playlist', { contains: true }),
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
    results: {
      type: 'json',
      description: 'Array with one boolean: whether the current user follows the playlist',
    },
  },
}
