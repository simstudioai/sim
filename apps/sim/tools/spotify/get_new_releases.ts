import type {
  SpotifyGetNewReleasesParams,
  SpotifyGetNewReleasesResponse,
} from '@/tools/spotify/types'
import { ALBUM_WITH_ARTISTS_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetNewReleasesTool: ToolConfig<
  SpotifyGetNewReleasesParams,
  SpotifyGetNewReleasesResponse
> = {
  id: 'spotify_get_new_releases',
  name: 'Spotify Get New Releases',
  description: 'Get a list of new album releases featured in Spotify.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-private'],
  },

  params: {
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "GB")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of releases to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of first release to return for pagination',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      let url = `https://api.spotify.com/v1/browse/new-releases?limit=${limit}&offset=${offset}`
      if (params.country) {
        url += `&country=${params.country}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetNewReleasesResponse> => {
    const data = await response.json()

    const albums = (data.albums?.items || []).map((album: any) => ({
      id: album.id,
      name: album.name,
      artists: album.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
      release_date: album.release_date,
      total_tracks: album.total_tracks,
      album_type: album.album_type,
      image_url: album.images?.[0]?.url || null,
      external_url: album.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        albums,
        total: data.albums?.total || 0,
        next: data.albums?.next || null,
      },
    }
  },

  outputs: {
    albums: {
      type: 'array',
      description: 'List of new releases',
      items: { type: 'object', properties: ALBUM_WITH_ARTISTS_OUTPUT_PROPERTIES },
    },
    total: { type: 'number', description: 'Total number of new releases' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
