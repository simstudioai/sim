import { spotifyLibraryUrl } from '@/tools/spotify/utils'
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
      description: 'Comma-separated track IDs to remove (max 40)',
    },
  },

  request: {
    url: (params) => spotifyLibraryUrl(params.trackIds, 'track'),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifyRemoveSavedTracksResponse> => {
    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether tracks were removed successfully' },
  },
}
