import type { SpotifyGetTopItemsParams, SpotifyGetTopTracksResponse } from '@/tools/spotify/types'
import {
  SIMPLIFIED_ALBUM_OUTPUT_PROPERTIES,
  SIMPLIFIED_ARTIST_OUTPUT_PROPERTIES,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetTopTracksTool: ToolConfig<
  SpotifyGetTopItemsParams,
  SpotifyGetTopTracksResponse
> = {
  id: 'spotify_get_top_tracks',
  name: 'Spotify Get Top Tracks',
  description: "Get the current user's top tracks based on listening history.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-top-read'],
  },

  params: {
    time_range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'medium_term',
      description: 'Time range: short_term (~4 weeks), medium_term (~6 months), long_term (years)',
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
      description: 'Index of the first track to return for pagination',
    },
  },

  request: {
    url: (params) => {
      const timeRange = params.time_range || 'medium_term'
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      return `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}&offset=${offset}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetTopTracksResponse> => {
    const data = await response.json()

    const tracks = (data.items || []).map((track: any) => ({
      id: track.id,
      name: track.name,
      artists: track.artists?.map((a: any) => ({ id: a.id, name: a.name })) || [],
      album: {
        id: track.album?.id || '',
        name: track.album?.name || '',
        image_url: track.album?.images?.[0]?.url || null,
      },
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      external_url: track.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        tracks,
        total: data.total || tracks.length,
        next: data.next || null,
      },
    }
  },

  outputs: {
    tracks: {
      type: 'array',
      description: "User's top tracks",
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
          duration_ms: { type: 'number', description: 'Duration in milliseconds' },
          popularity: { type: 'number', description: 'Popularity score' },
          external_url: { type: 'string', description: 'Spotify URL' },
        },
      },
    },
    total: { type: 'number', description: 'Total number of top tracks' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
