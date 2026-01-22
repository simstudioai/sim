import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyRemoveSavedEpisodesParams {
  accessToken: string
  episodeIds: string
}

interface SpotifyRemoveSavedEpisodesResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyRemoveSavedEpisodesTool: ToolConfig<
  SpotifyRemoveSavedEpisodesParams,
  SpotifyRemoveSavedEpisodesResponse
> = {
  id: 'spotify_remove_saved_episodes',
  name: 'Spotify Remove Saved Episodes',
  description: "Remove podcast episodes from the user's library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-modify'],
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
      return `https://api.spotify.com/v1/me/episodes?ids=${ids}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifyRemoveSavedEpisodesResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether episodes were removed' },
  },
}
