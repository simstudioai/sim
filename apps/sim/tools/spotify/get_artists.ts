import { ARTIST_OUTPUT_PROPERTIES } from '@/tools/spotify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetArtistsParams {
  accessToken: string
  artistIds: string
}

interface SpotifyGetArtistsResponse extends ToolResponse {
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
  }
}

export const spotifyGetArtistsTool: ToolConfig<SpotifyGetArtistsParams, SpotifyGetArtistsResponse> =
  {
    id: 'spotify_get_artists',
    name: 'Spotify Get Multiple Artists',
    description: 'Get details for multiple artists by their IDs.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'spotify',
      requiredScopes: ['user-read-private'],
    },

    params: {
      artistIds: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Comma-separated artist IDs (max 50)',
      },
    },

    request: {
      url: (params) => {
        const ids = params.artistIds
          .split(',')
          .map((id) => id.trim())
          .slice(0, 50)
          .join(',')
        return `https://api.spotify.com/v1/artists?ids=${ids}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response): Promise<SpotifyGetArtistsResponse> => {
      const data = await response.json()

      const artists = (data.artists || []).map((artist: any) => ({
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
        output: { artists },
      }
    },

    outputs: {
      artists: {
        type: 'array',
        description: 'List of artists',
        items: { type: 'object', properties: ARTIST_OUTPUT_PROPERTIES },
      },
    },
  }
