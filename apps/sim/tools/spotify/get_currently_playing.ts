import { CURRENTLY_PLAYING_TRACK_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetCurrentlyPlayingParams {
  accessToken: string
  market?: string
}

interface SpotifyGetCurrentlyPlayingResponse extends ToolResponse {
  output: {
    is_playing: boolean
    progress_ms: number | null
    track: {
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
      external_url: string
    } | null
  }
}

export const spotifyGetCurrentlyPlayingTool: ToolConfig<
  SpotifyGetCurrentlyPlayingParams,
  SpotifyGetCurrentlyPlayingResponse
> = {
  id: 'spotify_get_currently_playing',
  name: 'Spotify Get Currently Playing',
  description: "Get the user's currently playing track.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-currently-playing'],
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
      let url = 'https://api.spotify.com/v1/me/player/currently-playing'
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

  transformResponse: async (response): Promise<SpotifyGetCurrentlyPlayingResponse> => {
    if (response.status === 204) {
      return {
        success: true,
        output: {
          is_playing: false,
          progress_ms: null,
          track: null,
        },
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        is_playing: data.is_playing || false,
        progress_ms: data.progress_ms || null,
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
              external_url: data.item.external_urls?.spotify || '',
            }
          : null,
      },
    }
  },

  outputs: {
    is_playing: { type: 'boolean', description: 'Whether playback is active' },
    progress_ms: { type: 'number', description: 'Current position in track (ms)', optional: true },
    track: {
      type: 'object',
      description: 'Currently playing track',
      optional: true,
      properties: CURRENTLY_PLAYING_TRACK_OUTPUT_PROPERTIES,
    },
  },
}
