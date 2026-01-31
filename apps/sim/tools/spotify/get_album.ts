import type { SpotifyGetAlbumParams, SpotifyGetAlbumResponse } from '@/tools/spotify/types'
import {
  SIMPLIFIED_ALBUM_TRACK_OUTPUT_PROPERTIES,
  SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetAlbumTool: ToolConfig<SpotifyGetAlbumParams, SpotifyGetAlbumResponse> = {
  id: 'spotify_get_album',
  name: 'Spotify Get Album',
  description:
    'Get detailed information about an album on Spotify by its ID, including track listing.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
  },

  params: {
    albumId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify ID of the album',
    },
    market: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code for track availability (e.g., "US", "GB")',
    },
  },

  request: {
    url: (params) => {
      let url = `https://api.spotify.com/v1/albums/${params.albumId}`
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

  transformResponse: async (response): Promise<SpotifyGetAlbumResponse> => {
    const album = await response.json()

    return {
      success: true,
      output: {
        id: album.id,
        name: album.name,
        artists: album.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
        album_type: album.album_type,
        total_tracks: album.total_tracks,
        release_date: album.release_date,
        label: album.label || '',
        popularity: album.popularity,
        genres: album.genres || [],
        image_url: album.images?.[0]?.url || null,
        tracks: (album.tracks?.items || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          duration_ms: t.duration_ms,
          track_number: t.track_number,
        })),
        external_url: album.external_urls?.spotify || '',
      },
    }
  },

  outputs: {
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
    label: { type: 'string', description: 'Record label' },
    popularity: { type: 'number', description: 'Popularity score (0-100)' },
    genres: { type: 'array', description: 'List of genres' },
    image_url: { type: 'string', description: 'Album cover image URL', optional: true },
    tracks: {
      type: 'array',
      description: 'List of tracks on the album',
      items: { type: 'object', properties: SIMPLIFIED_ALBUM_TRACK_OUTPUT_PROPERTIES },
    },
    external_url: { type: 'string', description: 'Spotify URL' },
  },
}
