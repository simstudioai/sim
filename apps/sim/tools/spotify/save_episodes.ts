import { sendRemainingSpotifyLibraryChunks, spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifySaveEpisodesParams {
  accessToken: string
  episodeIds: string
}

interface SpotifySaveEpisodesResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifySaveEpisodesTool: ToolConfig<
  SpotifySaveEpisodesParams,
  SpotifySaveEpisodesResponse
> = {
  id: 'spotify_save_episodes',
  name: 'Spotify Save Episodes',
  description: "Save podcast episodes to the user's library.",
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
    url: (params) => spotifyLibraryUrl(params.episodeIds, 'episode', { maxIds: 50 }),
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (_response, params, context): Promise<SpotifySaveEpisodesResponse> => {
    if (params)
      await sendRemainingSpotifyLibraryChunks(
        params,
        params.episodeIds,
        'episode',
        'PUT',
        {
          maxIds: 50,
        },
        context?.signal
      )
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether episodes were saved' },
  },
}
