import { PLAYBACK_TRACK_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetQueueParams {
  accessToken: string
}

interface SpotifyGetQueueResponse extends ToolResponse {
  output: {
    currently_playing: {
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
    } | null
    queue: Array<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album: {
        id: string
        name: string
        image_url: string | null
      }
      duration_ms: number
    }>
  }
}

export const spotifyGetQueueTool: ToolConfig<SpotifyGetQueueParams, SpotifyGetQueueResponse> = {
  id: 'spotify_get_queue',
  name: 'Spotify Get Queue',
  description: "Get the user's playback queue.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-playback-state'],
  },

  params: {},

  request: {
    url: () => 'https://api.spotify.com/v1/me/player/queue',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetQueueResponse> => {
    const data = await response.json()

    const formatTrack = (track: any) => ({
      id: track.id,
      name: track.name,
      artists: track.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
      album: {
        id: track.album?.id || '',
        name: track.album?.name || '',
        image_url: track.album?.images?.[0]?.url || null,
      },
      duration_ms: track.duration_ms,
    })

    return {
      success: true,
      output: {
        currently_playing: data.currently_playing ? formatTrack(data.currently_playing) : null,
        queue: (data.queue || []).map(formatTrack),
      },
    }
  },

  outputs: {
    currently_playing: {
      type: 'object',
      description: 'Currently playing track',
      optional: true,
      properties: PLAYBACK_TRACK_OUTPUT_PROPERTIES,
    },
    queue: {
      type: 'array',
      description: 'Upcoming tracks in queue',
      items: { type: 'object', properties: PLAYBACK_TRACK_OUTPUT_PROPERTIES },
    },
  },
}
