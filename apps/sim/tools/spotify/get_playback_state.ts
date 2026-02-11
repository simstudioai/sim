import type {
  SpotifyGetPlaybackStateParams,
  SpotifyGetPlaybackStateResponse,
} from '@/tools/spotify/types'
import {
  PLAYBACK_TRACK_OUTPUT_PROPERTIES,
  SIMPLIFIED_DEVICE_OUTPUT_PROPERTIES,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetPlaybackStateTool: ToolConfig<
  SpotifyGetPlaybackStateParams,
  SpotifyGetPlaybackStateResponse
> = {
  id: 'spotify_get_playback_state',
  name: 'Spotify Get Playback State',
  description: 'Get the current playback state including device, track, and progress.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-playback-state'],
  },

  params: {
    market: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "GB")',
    },
  },

  request: {
    url: (params) => {
      let url = 'https://api.spotify.com/v1/me/player'
      if (params.market) {
        url += `?market=${params.market}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetPlaybackStateResponse> => {
    if (response.status === 204) {
      return {
        success: true,
        output: {
          is_playing: false,
          device: null,
          progress_ms: null,
          currently_playing_type: 'unknown',
          shuffle_state: false,
          repeat_state: 'off',
          track: null,
        },
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        is_playing: data.is_playing || false,
        device: data.device
          ? {
              id: data.device.id,
              name: data.device.name,
              type: data.device.type,
              volume_percent: data.device.volume_percent,
            }
          : null,
        progress_ms: data.progress_ms,
        currently_playing_type: data.currently_playing_type || 'unknown',
        shuffle_state: data.shuffle_state || false,
        repeat_state: data.repeat_state || 'off',
        track: data.item
          ? {
              id: data.item.id,
              name: data.item.name,
              artists: data.item.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
              album: {
                id: data.item.album?.id || '',
                name: data.item.album?.name || '',
                image_url: data.item.album?.images?.[0]?.url || null,
              },
              duration_ms: data.item.duration_ms,
            }
          : null,
      },
    }
  },

  outputs: {
    is_playing: { type: 'boolean', description: 'Whether playback is active' },
    device: {
      type: 'object',
      description: 'Active device information',
      optional: true,
      properties: SIMPLIFIED_DEVICE_OUTPUT_PROPERTIES,
    },
    progress_ms: { type: 'number', description: 'Progress in milliseconds', optional: true },
    currently_playing_type: { type: 'string', description: 'Type of content playing' },
    shuffle_state: { type: 'boolean', description: 'Whether shuffle is enabled' },
    repeat_state: { type: 'string', description: 'Repeat mode (off, track, context)' },
    track: {
      type: 'object',
      description: 'Currently playing track',
      optional: true,
      properties: PLAYBACK_TRACK_OUTPUT_PROPERTIES,
    },
  },
}
