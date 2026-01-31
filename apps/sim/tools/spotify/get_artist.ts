import type { SpotifyGetArtistParams, SpotifyGetArtistResponse } from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetArtistTool: ToolConfig<SpotifyGetArtistParams, SpotifyGetArtistResponse> = {
  id: 'spotify_get_artist',
  name: 'Spotify Get Artist',
  description: 'Get detailed information about an artist on Spotify by their ID.',
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
  },

  request: {
    url: (params) => `https://api.spotify.com/v1/artists/${params.artistId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetArtistResponse> => {
    const artist = await response.json()

    return {
      success: true,
      output: {
        id: artist.id,
        name: artist.name,
        genres: artist.genres || [],
        popularity: artist.popularity,
        followers: artist.followers?.total || 0,
        image_url: artist.images?.[0]?.url || null,
        external_url: artist.external_urls?.spotify || '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Spotify artist ID' },
    name: { type: 'string', description: 'Artist name' },
    genres: { type: 'array', description: 'List of genres associated with the artist' },
    popularity: { type: 'number', description: 'Popularity score (0-100)' },
    followers: { type: 'number', description: 'Number of followers' },
    image_url: { type: 'string', description: 'Artist image URL', optional: true },
    external_url: { type: 'string', description: 'Spotify URL' },
  },
}
