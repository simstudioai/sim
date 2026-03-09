import type {
  SpotifyCheckSavedTracksParams,
  SpotifyCheckSavedTracksResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyCheckSavedTracksTool: ToolConfig<
  SpotifyCheckSavedTracksParams,
  SpotifyCheckSavedTracksResponse
> = {
  id: 'spotify_check_saved_tracks',
  name: 'Spotify Check Saved Tracks',
  description: "Check if one or more tracks are saved in the user's library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    trackIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated track IDs to check (max 50)',
    },
  },

  request: {
    url: (params) => {
      const ids = params.trackIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      return `https://api.spotify.com/v1/me/tracks/contains?ids=${ids}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params): Promise<SpotifyCheckSavedTracksResponse> => {
    const data = await response.json()
    const ids = (params?.trackIds || '')
      .split(',')
      .map((id) => id.trim())
      .slice(0, 50)

    const results = ids.map((id, index) => ({
      id,
      saved: data[index] || false,
    }))

    return {
      success: true,
      output: {
        results,
        all_saved: data.every((saved: boolean) => saved),
        none_saved: data.every((saved: boolean) => !saved),
      },
    }
  },

  outputs: {
    results: { type: 'json', description: 'Array of track IDs with saved status' },
    all_saved: { type: 'boolean', description: 'Whether all tracks are saved' },
    none_saved: { type: 'boolean', description: 'Whether no tracks are saved' },
  },
}
