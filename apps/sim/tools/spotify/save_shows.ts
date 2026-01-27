import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifySaveShowsParams {
  accessToken: string
  showIds: string
}

interface SpotifySaveShowsResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifySaveShowsTool: ToolConfig<SpotifySaveShowsParams, SpotifySaveShowsResponse> = {
  id: 'spotify_save_shows',
  name: 'Spotify Save Shows',
  description: "Save podcast shows to the user's library.",
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
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (): Promise<SpotifySaveShowsResponse> => {
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether shows were saved' },
  },
}
