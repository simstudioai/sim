import { readSpotifyLibraryChecks, spotifyLibraryUrl } from '@/tools/spotify/utils'
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
    url: (params) =>
      spotifyLibraryUrl(params.episodeIds, 'episode', { contains: true, maxIds: 50 }),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (
    response,
    params,
    context
  ): Promise<SpotifyCheckSavedEpisodesResponse> => {
    const results = await readSpotifyLibraryChecks(
      response,
      params && { params, ids: params.episodeIds, type: 'episode', maxIds: 50 },
      context?.signal
    )
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each episode' },
  },
}
