import type { SpotifyPauseParams, SpotifyPauseResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyPauseTool: ToolConfig<SpotifyPauseParams, SpotifyPauseResponse> = {
  id: 'spotify_pause',
  name: 'Spotify Pause',
  description: 'Pause playback on Spotify.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-modify-playback-state'],
  },

  params: {
    device_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device ID to pause. If not provided, pauses active device.',
    },
  },

  request: {
    url: (params) => {
      let url = 'https://api.spotify.com/v1/me/player/pause'
      if (params.device_id) {
        url += `?device_id=${params.device_id}`
      }
      return url
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (): Promise<SpotifyPauseResponse> => {
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether playback was paused' },
  },
}
