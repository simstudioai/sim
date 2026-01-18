import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifySaveAudiobooksParams {
  accessToken: string
  audiobookIds: string
}

interface SpotifySaveAudiobooksResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifySaveAudiobooksTool: ToolConfig<
  SpotifySaveAudiobooksParams,
  SpotifySaveAudiobooksResponse
> = {
  id: 'spotify_save_audiobooks',
  name: 'Spotify Save Audiobooks',
  description: "Save audiobooks to the user's library.",
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
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifySaveAudiobooksResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether audiobooks were saved' },
  },
}
