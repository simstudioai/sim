import type { SpotifyAddToQueueParams, SpotifyAddToQueueResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyAddToQueueTool: ToolConfig<SpotifyAddToQueueParams, SpotifyAddToQueueResponse> =
  {
    id: 'spotify_add_to_queue',
    name: 'Spotify Add to Queue',
    description: "Add a track to the user's playback queue.",
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'spotify',
      requiredScopes: ['user-modify-playback-state'],
    },

    params: {
      uri: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Spotify URI of the track to add (e.g., "spotify:track:xxx")',
      },
      device_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Device ID. If not provided, uses active device.',
      },
    },

    request: {
      url: (params) => {
        let url = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(params.uri)}`
        if (params.device_id) {
          url += `&device_id=${params.device_id}`
        }
        return url
      },
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (): Promise<SpotifyAddToQueueResponse> => {
      return {
        success: true,
        output: {
          success: true,
        },
      }
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether track was added to queue' },
    },
  }
