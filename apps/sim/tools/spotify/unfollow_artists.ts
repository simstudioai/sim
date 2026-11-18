import { spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyUnfollowArtistsParams {
  accessToken: string
  artistIds: string
}

interface SpotifyUnfollowArtistsResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const spotifyUnfollowArtistsTool: ToolConfig<
  SpotifyUnfollowArtistsParams,
  SpotifyUnfollowArtistsResponse
> = {
  id: 'spotify_unfollow_artists',
  name: 'Spotify Unfollow Artists',
  description: 'Unfollow one or more artists.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-follow-modify'],
  },

  params: {
    artistIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated artist IDs to unfollow (max 40)',
    },
  },

  request: {
    url: (params) => spotifyLibraryUrl(params.artistIds, 'artist'),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifyUnfollowArtistsResponse> => {
    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether artists were unfollowed successfully' },
  },
}
