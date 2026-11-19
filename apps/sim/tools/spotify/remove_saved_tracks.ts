import { sendRemainingSpotifyLibraryChunks, spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyRemoveSavedTracksParams {
  accessToken: string
  trackIds: string
}

interface SpotifyRemoveSavedTracksResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const spotifyRemoveSavedTracksTool: ToolConfig<
  SpotifyRemoveSavedTracksParams,
  SpotifyRemoveSavedTracksResponse
> = {
  id: 'spotify_remove_saved_tracks',
  name: 'Spotify Remove Saved Tracks',
  description: "Remove tracks from the user's library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-modify'],
  },

  params: {
    trackIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated track IDs to remove (max 50)',
    },
  },

  request: {
    url: (params) => spotifyLibraryUrl(params.trackIds, 'track', { maxIds: 50 }),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (
    _response,
    params,
    context
  ): Promise<SpotifyRemoveSavedTracksResponse> => {
    if (params)
      await sendRemainingSpotifyLibraryChunks(
        params,
        params.trackIds,
        'track',
        'DELETE',
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
    success: { type: 'boolean', description: 'Whether tracks were removed successfully' },
  },
}
