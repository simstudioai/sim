import type { SpotifyGetTracksParams, SpotifyGetTracksResponse } from '@/tools/spotify/types'
import {
  SIMPLIFIED_ALBUM_OUTPUT_PROPERTIES,
  SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetTracksTool: ToolConfig<SpotifyGetTracksParams, SpotifyGetTracksResponse> = {
  id: 'spotify_get_tracks',
  name: 'Spotify Get Multiple Tracks',
  description: 'Get detailed information about multiple tracks on Spotify by their IDs (up to 50).',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
  },

  params: {
    trackIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of Spotify track IDs (max 50)',
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
      let url = `https://api.spotify.com/v1/tracks?ids=${encodeURIComponent(params.trackIds)}`
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

  transformResponse: async (response): Promise<SpotifyGetTracksResponse> => {
    const data = await response.json()

    const tracks = (data.tracks || [])
      .filter((t: any) => t !== null)
      .map((track: any) => ({
        id: track.id,
        name: track.name,
        artists: track.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
        album: {
          id: track.album?.id || '',
          name: track.album?.name || '',
          image_url: track.album?.images?.[0]?.url || null,
        },
        duration_ms: track.duration_ms,
        explicit: track.explicit,
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
      description: 'List of tracks',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Spotify track ID' },
          name: { type: 'string', description: 'Track name' },
          artists: {
            type: 'array',
            description: 'List of artists',
            items: { type: 'object', properties: SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES },
          },
          album: {
            type: 'object',
            description: 'Album information',
            properties: SIMPLIFIED_ALBUM_OUTPUT_PROPERTIES,
          },
          duration_ms: { type: 'number', description: 'Track duration in milliseconds' },
          explicit: { type: 'boolean', description: 'Whether the track has explicit content' },
          popularity: { type: 'number', description: 'Popularity score (0-100)' },
          preview_url: { type: 'string', description: 'URL to 30-second preview', optional: true },
          external_url: { type: 'string', description: 'Spotify URL' },
        },
      },
    },
  },
}
