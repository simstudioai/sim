import { ALBUM_TRACK_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetAlbumTracksParams {
  accessToken: string
  albumId: string
  limit?: number
  offset?: number
  market?: string
}

interface SpotifyGetAlbumTracksResponse extends ToolResponse {
  output: {
    tracks: Array<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      duration_ms: number
      track_number: number
      disc_number: number
      explicit: boolean
      preview_url: string | null
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetAlbumTracksTool: ToolConfig<
  SpotifyGetAlbumTracksParams,
  SpotifyGetAlbumTracksResponse
> = {
  id: 'spotify_get_album_tracks',
  name: 'Spotify Get Album Tracks',
  description: 'Get the tracks from an album.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-private'],
  },

  params: {
    albumId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify album ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of tracks to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of first track to return for pagination',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      let url = `https://api.spotify.com/v1/albums/${params.albumId}/tracks?limit=${limit}&offset=${offset}`
      if (params.market) {
        url += `&market=${params.market}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetAlbumTracksResponse> => {
    const data = await response.json()

    const tracks = (data.items || []).map((track: any) => ({
      id: track.id,
      name: track.name,
      artists: track.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
      duration_ms: track.duration_ms,
      track_number: track.track_number,
      disc_number: track.disc_number,
      explicit: track.explicit || false,
      preview_url: track.preview_url || null,
    }))

    return {
      success: true,
      output: {
        tracks,
        total: data.total || 0,
        next: data.next || null,
      },
    }
  },

  outputs: {
    tracks: {
      type: 'array',
      description: 'List of tracks',
      items: { type: 'object', properties: ALBUM_TRACK_OUTPUT_PROPERTIES },
    },
    total: { type: 'number', description: 'Total number of tracks' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
