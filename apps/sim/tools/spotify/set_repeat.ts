import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifySetRepeatParams {
  accessToken: string
  state: string
  device_id?: string
}

interface SpotifySetRepeatResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const spotifySetRepeatTool: ToolConfig<SpotifySetRepeatParams, SpotifySetRepeatResponse> = {
  id: 'spotify_set_repeat',
  name: 'Spotify Set Repeat',
  description: 'Set the repeat mode for playback.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-modify-playback-state'],
  },

  params: {
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repeat mode: "off", "track", or "context"',
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
      let url = `https://api.spotify.com/v1/me/player/repeat?state=${params.state}`
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

  transformResponse: async (): Promise<SpotifySetRepeatResponse> => {
    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether repeat mode was set successfully' },
  },
}
