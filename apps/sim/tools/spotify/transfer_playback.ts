import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyTransferPlaybackParams {
  accessToken: string
  device_id: string
  play?: boolean
}

interface SpotifyTransferPlaybackResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const spotifyTransferPlaybackTool: ToolConfig<
  SpotifyTransferPlaybackParams,
  SpotifyTransferPlaybackResponse
> = {
  id: 'spotify_transfer_playback',
  name: 'Spotify Transfer Playback',
  description: 'Transfer playback to a different device.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-modify-playback-state'],
  },

  params: {
    device_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device ID to transfer playback to',
    },
    play: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      default: true,
      description: 'Whether to start playing on the new device',
    },
  },

  request: {
    url: () => 'https://api.spotify.com/v1/me/player',
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      device_ids: [params.device_id],
      play: params.play ?? true,
    }),
  },

  transformResponse: async (): Promise<SpotifyTransferPlaybackResponse> => {
    return {
      success: true,
      output: { success: true },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether transfer was successful' },
  },
}
