import type { SpotifySaveTracksParams, SpotifySaveTracksResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifySaveTracksTool: ToolConfig<SpotifySaveTracksParams, SpotifySaveTracksResponse> =
  {
    id: 'spotify_save_tracks',
    name: 'Spotify Save Tracks',
    description: "Save tracks to the current user's library (like tracks).",
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
        description: 'Comma-separated Spotify track IDs to save (max 50)',
      },
    },

    request: {
      url: (params) =>
        `https://api.spotify.com/v1/me/tracks?ids=${encodeURIComponent(params.trackIds)}`,
      method: 'PUT',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (): Promise<SpotifySaveTracksResponse> => {
      return {
        success: true,
        output: {
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether the tracks were saved successfully' },
    },
  }
