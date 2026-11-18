import { sendRemainingSpotifyLibraryChunks, spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyFollowArtistsParams {
  accessToken: string
  artistIds: string
}

interface SpotifyFollowArtistsResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const spotifyFollowArtistsTool: ToolConfig<
  SpotifyFollowArtistsParams,
  SpotifyFollowArtistsResponse
> = {
  id: 'spotify_follow_artists',
  name: 'Spotify Follow Artists',
  description: 'Follow one or more artists.',
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
      description: 'Comma-separated artist IDs to follow (max 50)',
    },
  },

  request: {
    url: (params) => spotifyLibraryUrl(params.artistIds, 'artist', { maxIds: 50 }),
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (_response, params, context): Promise<SpotifyFollowArtistsResponse> => {
    if (params)
      await sendRemainingSpotifyLibraryChunks(
        params,
        params.artistIds,
        'artist',
        'PUT',
        {
          maxIds: 50,
        },
        context?.signal
      )
    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether artists were followed successfully' },
  },
}
