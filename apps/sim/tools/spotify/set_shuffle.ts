import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifySetShuffleParams {
  accessToken: string
  state: boolean
  device_id?: string
}

interface SpotifySetShuffleResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const spotifySetShuffleTool: ToolConfig<SpotifySetShuffleParams, SpotifySetShuffleResponse> =
  {
    id: 'spotify_set_shuffle',
    name: 'Spotify Set Shuffle',
    description: 'Turn shuffle on or off.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'spotify',
      requiredScopes: ['user-modify-playback-state'],
    },

    params: {
      state: {
        type: 'boolean',
        required: true,
        visibility: 'user-or-llm',
        description: 'true for shuffle on, false for off',
      },
      device_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Spotify device ID to target for playback',
      },
    },

    request: {
      url: (params) => {
        let url = `https://api.spotify.com/v1/me/player/shuffle?state=${params.state}`
        if (params.device_id) {
          url += `&device_id=${params.device_id}`
        }
        return url
      },
      method: 'PUT',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (): Promise<SpotifySetShuffleResponse> => {
      return {
        success: true,
        output: { success: true },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether shuffle was set successfully' },
    },
  }
