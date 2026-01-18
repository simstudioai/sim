import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifySaveAlbumsParams {
  accessToken: string
  albumIds: string
}

interface SpotifySaveAlbumsResponse extends ToolResponse {
  output: { success: boolean }
}

export const spotifySaveAlbumsTool: ToolConfig<SpotifySaveAlbumsParams, SpotifySaveAlbumsResponse> =
  {
    id: 'spotify_save_albums',
    name: 'Spotify Save Albums',
    description: "Save albums to the user's library.",
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'spotify',
      requiredScopes: ['user-library-modify'],
    },

    params: {
      albumIds: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Comma-separated album IDs (max 20)',
      },
    },

    request: {
      url: () => 'https://api.spotify.com/v1/me/albums',
      method: 'PUT',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        ids: params.albumIds
          .split(',')
          .map((id) => id.trim())
          .slice(0, 20),
      }),
    },

    transformResponse: async (): Promise<SpotifySaveAlbumsResponse> => {
      return { success: true, output: { success: true } }
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether albums were saved' },
    },
  }
