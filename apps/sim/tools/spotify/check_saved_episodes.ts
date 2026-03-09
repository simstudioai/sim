import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyCheckSavedEpisodesParams {
  accessToken: string
  episodeIds: string
}

interface SpotifyCheckSavedEpisodesResponse extends ToolResponse {
  output: { results: boolean[] }
}

export const spotifyCheckSavedEpisodesTool: ToolConfig<
  SpotifyCheckSavedEpisodesParams,
  SpotifyCheckSavedEpisodesResponse
> = {
  id: 'spotify_check_saved_episodes',
  name: 'Spotify Check Saved Episodes',
  description: 'Check if episodes are saved in library.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    episodeIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated episode IDs (max 50)',
    },
  },

  request: {
    url: (params) => {
      const ids = params.episodeIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      return `https://api.spotify.com/v1/me/episodes/contains?ids=${ids}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyCheckSavedEpisodesResponse> => {
    const results = await response.json()
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each episode' },
  },
}
