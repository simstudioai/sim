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
    url: (params) => {
      const ids = params.audiobookIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      return `https://api.spotify.com/v1/me/audiobooks?ids=${ids}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifyRemoveSavedAudiobooksResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether audiobooks were removed' },
  },
}
