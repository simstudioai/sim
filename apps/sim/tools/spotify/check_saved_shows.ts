import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyCheckSavedShowsParams {
  accessToken: string
  showIds: string
}

interface SpotifyCheckSavedShowsResponse extends ToolResponse {
  output: { results: boolean[] }
}

export const spotifyCheckSavedShowsTool: ToolConfig<
  SpotifyCheckSavedShowsParams,
  SpotifyCheckSavedShowsResponse
> = {
  id: 'spotify_check_saved_shows',
  name: 'Spotify Check Saved Shows',
  description: 'Check if shows are saved in library.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
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
      return `https://api.spotify.com/v1/me/shows/contains?ids=${ids}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyCheckSavedShowsResponse> => {
    const results = await response.json()
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each show' },
  },
}
