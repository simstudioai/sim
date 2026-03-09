import type { SpotifySkipPreviousParams, SpotifySkipPreviousResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifySkipPreviousTool: ToolConfig<
  SpotifySkipPreviousParams,
  SpotifySkipPreviousResponse
> = {
  id: 'spotify_skip_previous',
  name: 'Spotify Skip to Previous',
  description: 'Skip to the previous track on Spotify.',
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
      let url = 'https://api.spotify.com/v1/me/player/previous'
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

  transformResponse: async (): Promise<SpotifySkipPreviousResponse> => {
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
