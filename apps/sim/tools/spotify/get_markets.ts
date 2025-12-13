import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetMarketsParams {
  accessToken: string
}

interface SpotifyGetMarketsResponse extends ToolResponse {
  output: {
    markets: string[]
  }
}

export const spotifyGetMarketsTool: ToolConfig<SpotifyGetMarketsParams, SpotifyGetMarketsResponse> =
  {
    id: 'spotify_get_markets',
    name: 'Spotify Get Available Markets',
    description: 'Get the list of markets where Spotify is available.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'spotify',
      requiredScopes: ['user-read-private'],
    },

    params: {},

    request: {
      url: () => 'https://api.spotify.com/v1/markets',
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response): Promise<SpotifyGetMarketsResponse> => {
      const data = await response.json()
      return {
        success: true,
        output: { markets: data.markets || [] },
      }
    },

    outputs: {
      markets: { type: 'json', description: 'List of ISO country codes' },
    },
  }
