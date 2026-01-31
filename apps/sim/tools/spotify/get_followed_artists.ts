import { ARTIST_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetFollowedArtistsParams {
  accessToken: string
  limit?: number
  after?: string
}

interface SpotifyGetFollowedArtistsResponse extends ToolResponse {
  output: {
    artists: Array<{
      id: string
      name: string
      genres: string[]
      popularity: number
      followers: number
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetFollowedArtistsTool: ToolConfig<
  SpotifyGetFollowedArtistsParams,
  SpotifyGetFollowedArtistsResponse
> = {
  id: 'spotify_get_followed_artists',
  name: 'Spotify Get Followed Artists',
  description: "Get the user's followed artists.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-follow-read'],
  },

  params: {
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of artists to return (1-50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination (last artist ID from previous request)',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      let url = `https://api.spotify.com/v1/me/following?type=artist&limit=${limit}`
      if (params.after) {
        url += `&after=${params.after}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetFollowedArtistsResponse> => {
    const data = await response.json()

    const artists = (data.artists?.items || []).map((artist: any) => ({
      id: artist.id,
      name: artist.name,
      genres: artist.genres || [],
      popularity: artist.popularity || 0,
      followers: artist.followers?.total || 0,
      image_url: artist.images?.[0]?.url || null,
      external_url: artist.external_urls?.spotify || '',
    }))

    return {
      success: true,
      output: {
        artists,
        total: data.artists?.total || 0,
        next: data.artists?.cursors?.after || null,
      },
    }
  },

  outputs: {
    artists: {
      type: 'array',
      description: 'List of followed artists',
      items: { type: 'object', properties: ARTIST_OUTPUT_PROPERTIES },
    },
    total: { type: 'number', description: 'Total number of followed artists' },
    next: { type: 'string', description: 'Cursor for next page', optional: true },
  },
}
