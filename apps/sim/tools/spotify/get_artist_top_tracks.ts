import type { ToolConfig } from '@/tools/types'
import type { SpotifyGetArtistTopTracksParams, SpotifyGetArtistTopTracksResponse } from './types'

export const spotifyGetArtistTopTracksTool: ToolConfig<
  SpotifyGetArtistTopTracksParams,
  SpotifyGetArtistTopTracksResponse
> = {
  id: 'spotify_get_artist_top_tracks',
  name: 'Spotify Get Artist Top Tracks',
  description: 'Get the top 10 most popular tracks by an artist on Spotify.',
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
    market: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      default: 'US',
      description: 'ISO 3166-1 alpha-2 country code (required for this endpoint)',
    },
  },

  request: {
    url: (params) => {
      const market = params.market || 'US'
      return `https://api.spotify.com/v1/artists/${params.artistId}/top-tracks?market=${market}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetArtistTopTracksResponse> => {
    const data = await response.json()

    const tracks = (data.tracks || []).map((track: any) => ({
      id: track.id,
      name: track.name,
      album: {
        id: track.album?.id || '',
        name: track.album?.name || '',
        image_url: track.album?.images?.[0]?.url || null,
      },
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      preview_url: track.preview_url,
      external_url: track.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        tracks,
      },
    }
  },

  outputs: {
    tracks: {
      type: 'array',
      description: "Artist's top tracks",
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Spotify track ID' },
          name: { type: 'string', description: 'Track name' },
          album: { type: 'object', description: 'Album information' },
          duration_ms: { type: 'number', description: 'Track duration in milliseconds' },
          popularity: { type: 'number', description: 'Popularity score (0-100)' },
          preview_url: { type: 'string', description: 'URL to 30-second preview' },
          external_url: { type: 'string', description: 'Spotify URL' },
        },
      },
    },
  },
}
