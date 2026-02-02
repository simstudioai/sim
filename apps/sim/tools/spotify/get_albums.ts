import { SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetAlbumsParams {
  accessToken: string
  albumIds: string
  market?: string
}

interface SpotifyGetAlbumsResponse extends ToolResponse {
  output: {
    albums: Array<{
      id: string
      name: string
      artists: Array<{ id: string; name: string }>
      album_type: string
      total_tracks: number
      release_date: string
      image_url: string | null
      external_url: string
    }>
  }
}

export const spotifyGetAlbumsTool: ToolConfig<SpotifyGetAlbumsParams, SpotifyGetAlbumsResponse> = {
  id: 'spotify_get_albums',
  name: 'Spotify Get Multiple Albums',
  description: 'Get details for multiple albums by their IDs.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-private'],
  },

  params: {
    albumIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated album IDs (max 20)',
    },
    market: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "GB")',
    },
  },

  request: {
    url: (params) => {
      const ids = params.albumIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 20)
        .join(',')
      let url = `https://api.spotify.com/v1/albums?ids=${ids}`
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

  transformResponse: async (response): Promise<SpotifyGetAlbumsResponse> => {
    const data = await response.json()

    const albums = (data.albums || []).map((album: any) => ({
      id: album.id,
      name: album.name,
      artists: album.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
      album_type: album.album_type,
      total_tracks: album.total_tracks,
      release_date: album.release_date,
      image_url: album.images?.[0]?.url || null,
      external_url: album.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: { albums },
    }
  },

  outputs: {
    albums: {
      type: 'array',
      description: 'List of albums',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Spotify album ID' },
          name: { type: 'string', description: 'Album name' },
          artists: {
            type: 'array',
            description: 'List of artists',
            items: { type: 'object', properties: SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES },
          },
          album_type: { type: 'string', description: 'Type of album (album, single, compilation)' },
          total_tracks: { type: 'number', description: 'Total number of tracks' },
          release_date: { type: 'string', description: 'Release date' },
          image_url: { type: 'string', description: 'Album cover image URL', optional: true },
          external_url: { type: 'string', description: 'Spotify URL' },
        },
      },
    },
  },
}
