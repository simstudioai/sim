import type { SpotifyPlayParams, SpotifyPlayResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyPlayTool: ToolConfig<SpotifyPlayParams, SpotifyPlayResponse> = {
  id: 'spotify_play',
  name: 'Spotify Play',
  description:
    'Start or resume playback on Spotify. Can play specific tracks, albums, or playlists.',
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
      description: 'Device ID to play on. If not provided, plays on active device.',
    },
    context_uri: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Spotify URI of album, artist, or playlist to play (e.g., "spotify:album:xxx")',
    },
    uris: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated track URIs to play (e.g., "spotify:track:xxx,spotify:track:yyy")',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position in context to start playing (0-based index)',
    },
    position_ms: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position in track to start from (in milliseconds)',
    },
  },

  request: {
    url: (params) => {
      let url = 'https://api.spotify.com/v1/me/player/play'
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
    body: (params) => {
      const body: any = {}
      if (params.context_uri) {
        body.context_uri = params.context_uri
      }
      if (params.uris) {
        body.uris = params.uris.split(',').map((uri) => uri.trim())
      }
      if (params.offset !== undefined) {
        body.offset = { position: params.offset }
      }
      if (params.position_ms !== undefined) {
        body.position_ms = params.position_ms
      }
      return Object.keys(body).length > 0 ? body : undefined
    },
  },

  transformResponse: async (): Promise<SpotifyPlayResponse> => {
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether playback started successfully' },
  },
}
