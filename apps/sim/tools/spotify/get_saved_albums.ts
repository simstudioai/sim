import { SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetSavedAlbumsParams {
  accessToken: string
  limit?: number
  offset?: number
  market?: string
}

interface SpotifyGetSavedAlbumsResponse extends ToolResponse {
  output: {
    albums: Array<{
      added_at: string
      album: {
        id: string
        name: string
        artists: Array<{ id: string; name: string }>
        total_tracks: number
        release_date: string
        image_url: string | null
        external_url: string
      }
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetSavedAlbumsTool: ToolConfig<
  SpotifyGetSavedAlbumsParams,
  SpotifyGetSavedAlbumsResponse
> = {
  id: 'spotify_get_saved_albums',
  name: 'Spotify Get Saved Albums',
  description: "Get the user's saved albums.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of albums to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of first album to return for pagination',
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
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      let url = `https://api.spotify.com/v1/me/albums?limit=${limit}&offset=${offset}`
      if (params.market) url += `&market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetSavedAlbumsResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        albums: (data.items || []).map((item: any) => ({
          added_at: item.added_at,
          album: {
            id: item.album.id,
            name: item.album.name,
            artists: item.album.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
            total_tracks: item.album.total_tracks,
            release_date: item.album.release_date,
            image_url: item.album.images?.[0]?.url || null,
            external_url: item.album.external_urls?.spotify || '',
          },
        })),
        total: data.total || 0,
        next: data.next || null,
      },
    }
  },

  outputs: {
    albums: {
      type: 'array',
      description: 'List of saved albums',
      items: {
        type: 'object',
        properties: {
          added_at: { type: 'string', description: 'When the album was saved' },
          album: {
            type: 'object',
            description: 'Album information',
            properties: {
              id: { type: 'string', description: 'Spotify album ID' },
              name: { type: 'string', description: 'Album name' },
              artists: {
                type: 'array',
                description: 'List of artists',
                items: { type: 'object', properties: SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES },
              },
              total_tracks: { type: 'number', description: 'Total number of tracks' },
              release_date: { type: 'string', description: 'Release date' },
              image_url: { type: 'string', description: 'Album cover image URL', optional: true },
              external_url: { type: 'string', description: 'Spotify URL' },
            },
          },
        },
      },
    },
    total: { type: 'number', description: 'Total saved albums' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
