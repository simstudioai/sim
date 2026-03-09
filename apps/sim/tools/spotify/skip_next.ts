import type { SpotifySkipNextParams, SpotifySkipNextResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifySkipNextTool: ToolConfig<SpotifySkipNextParams, SpotifySkipNextResponse> = {
  id: 'spotify_skip_next',
  name: 'Spotify Skip to Next',
  description: 'Skip to the next track on Spotify.',
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
      description: 'Device ID. If not provided, uses active device.',
    },
  },

  request: {
    url: (params) => {
      let url = 'https://api.spotify.com/v1/me/player/next'
      if (params.device_id) {
        url += `?device_id=${params.device_id}`
      }
      return url
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (): Promise<SpotifySkipNextResponse> => {
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether skip was successful' },
  },
}
