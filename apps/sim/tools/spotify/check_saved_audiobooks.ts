import { readSpotifyLibraryChecks, spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyCheckSavedAudiobooksParams {
  accessToken: string
  audiobookIds: string
}

interface SpotifyCheckSavedAudiobooksResponse extends ToolResponse {
  output: { results: boolean[] }
}

export const spotifyCheckSavedAudiobooksTool: ToolConfig<
  SpotifyCheckSavedAudiobooksParams,
  SpotifyCheckSavedAudiobooksResponse
> = {
  id: 'spotify_check_saved_audiobooks',
  name: 'Spotify Check Saved Audiobooks',
  description: 'Check if audiobooks are saved in library.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    audiobookIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated audiobook IDs (max 50)',
    },
  },

  request: {
    url: (params) =>
      spotifyLibraryUrl(params.audiobookIds, 'audiobook', { contains: true, maxIds: 50 }),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (
    response,
    params,
    context
  ): Promise<SpotifyCheckSavedAudiobooksResponse> => {
    const results = await readSpotifyLibraryChecks(
      response,
      params && { params, ids: params.audiobookIds, type: 'audiobook', maxIds: 50 },
      context?.signal
    )
    return { success: true, output: { results } }
  },

  outputs: {
    results: { type: 'json', description: 'Array of booleans for each audiobook' },
  },
}
