import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyRemoveSavedShowsParams {
  accessToken: string
  showIds: string
}

interface SpotifyRemoveSavedShowsResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyRemoveSavedShowsTool: ToolConfig<
  SpotifyRemoveSavedShowsParams,
  SpotifyRemoveSavedShowsResponse
> = {
  id: 'spotify_remove_saved_shows',
  name: 'Spotify Remove Saved Shows',
  description: "Remove podcast shows from the user's library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-modify'],
  },

  params: {
    showIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated show IDs (max 50)',
    },
  },

  request: {
    url: (params) => {
      const ids = params.showIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      return `https://api.spotify.com/v1/me/shows?ids=${ids}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifyRemoveSavedShowsResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether shows were removed' },
  },
}
