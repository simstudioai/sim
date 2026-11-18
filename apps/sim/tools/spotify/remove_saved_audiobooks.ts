import { sendRemainingSpotifyLibraryChunks, spotifyLibraryUrl } from '@/tools/spotify/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyRemoveSavedAudiobooksParams {
  accessToken: string
  audiobookIds: string
}

interface SpotifyRemoveSavedAudiobooksResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifyRemoveSavedAudiobooksTool: ToolConfig<
  SpotifyRemoveSavedAudiobooksParams,
  SpotifyRemoveSavedAudiobooksResponse
> = {
  id: 'spotify_remove_saved_audiobooks',
  name: 'Spotify Remove Saved Audiobooks',
  description: "Remove audiobooks from the user's library.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-modify'],
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
    url: (params) => spotifyLibraryUrl(params.audiobookIds, 'audiobook', { maxIds: 50 }),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (
    _response,
    params,
    context
  ): Promise<SpotifyRemoveSavedAudiobooksResponse> => {
    if (params)
      await sendRemainingSpotifyLibraryChunks(
        params,
        params.audiobookIds,
        'audiobook',
        'DELETE',
        {
          maxIds: 50,
        },
        context?.signal
      )
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether audiobooks were removed' },
  },
}
