import type { SpotifyGetTopArtistsResponse, SpotifyGetTopItemsParams } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetTopArtistsTool: ToolConfig<
  SpotifyGetTopItemsParams,
  SpotifyGetTopArtistsResponse
> = {
  id: 'spotify_get_top_artists',
  name: 'Spotify Get Top Artists',
  description: "Get the current user's top artists based on listening history.",
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
      description: 'Number of artists to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of the first artist to return for pagination',
    },
  },

  request: {
    url: (params) => {
      const timeRange = params.time_range || 'medium_term'
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      return `https://api.spotify.com/v1/me/top/artists?time_range=${timeRange}&limit=${limit}&offset=${offset}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetTopArtistsResponse> => {
    const data = await response.json()

    const artists = (data.items || []).map((artist: any) => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres || [],
      popularity: artist.popularity,
      followers: artist.followers?.total || 0,
      image_url: artist.images?.[0]?.url || null,
      external_url: artist.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        artists,
        total: data.total || artists.length,
        next: data.next || null,
      },
    }
  },

  outputs: {
    artists: {
      type: 'array',
      description: "User's top artists",
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Spotify artist ID' },
          name: { type: 'string', description: 'Artist name' },
          genres: { type: 'array', description: 'List of genres' },
          popularity: { type: 'number', description: 'Popularity score' },
          followers: { type: 'number', description: 'Number of followers' },
          image_url: { type: 'string', description: 'Artist image URL' },
          external_url: { type: 'string', description: 'Spotify URL' },
        },
      },
    },
    total: { type: 'number', description: 'Total number of top artists' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
