import type {
  SpotifyGetArtistAlbumsParams,
  SpotifyGetArtistAlbumsResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetArtistAlbumsTool: ToolConfig<
  SpotifyGetArtistAlbumsParams,
  SpotifyGetArtistAlbumsResponse
> = {
  id: 'spotify_get_artist_albums',
  name: 'Spotify Get Artist Albums',
  description: 'Get albums by an artist on Spotify. Can filter by album type.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
  },

  params: {
    artistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify ID of the artist',
    },
    include_groups: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by album type: album, single, appears_on, compilation (comma-separated)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Maximum number of albums to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of the first album to return for pagination',
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
      let url = `https://api.spotify.com/v1/artists/${params.artistId}/albums?limit=${limit}&offset=${offset}`
      if (params.include_groups) {
        url += `&include_groups=${encodeURIComponent(params.include_groups)}`
      }
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

  transformResponse: async (response): Promise<SpotifyGetArtistAlbumsResponse> => {
    const data = await response.json()

    const albums = (data.items || []).map((album: any) => ({
      id: album.id,
      name: album.name,
      album_type: album.album_type,
      total_tracks: album.total_tracks,
      release_date: album.release_date,
      image_url: album.images?.[0]?.url || null,
      external_url: album.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        albums,
        total: data.total || albums.length,
        next: data.next || null,
      },
    }
  },

  outputs: {
    albums: {
      type: 'array',
      description: "Artist's albums",
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Spotify album ID' },
          name: { type: 'string', description: 'Album name' },
          album_type: { type: 'string', description: 'Type (album, single, compilation)' },
          total_tracks: { type: 'number', description: 'Number of tracks' },
          release_date: { type: 'string', description: 'Release date' },
          image_url: { type: 'string', description: 'Album cover URL' },
          external_url: { type: 'string', description: 'Spotify URL' },
        },
      },
    },
    total: { type: 'number', description: 'Total number of albums available' },
    next: { type: 'string', description: 'URL for next page of results', optional: true },
  },
}
