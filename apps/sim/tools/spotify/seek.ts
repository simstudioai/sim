import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifySeekParams {
  accessToken: string
  position_ms: number
  device_id?: string
}

interface SpotifySeekResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const spotifySeekTool: ToolConfig<SpotifySeekParams, SpotifySeekResponse> = {
  id: 'spotify_seek',
  name: 'Spotify Seek',
  description: 'Seek to a position in the currently playing track.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-modify-playback-state'],
  },

  params: {
    position_ms: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Position in milliseconds to seek to',
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
      let url = `https://api.spotify.com/v1/me/player/seek?position_ms=${params.position_ms}`
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

  transformResponse: async (): Promise<SpotifySeekResponse> => {
    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether seek was successful' },
  },
}
