import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetShowsParams {
  accessToken: string
  showIds: string
  market?: string
}

interface SpotifyGetShowsResponse extends ToolResponse {
  output: {
    shows: Array<{
      id: string
      name: string
      publisher: string
      total_episodes: number
      image_url: string | null
      external_url: string
    }>
  }
}

export const spotifyGetShowsTool: ToolConfig<SpotifyGetShowsParams, SpotifyGetShowsResponse> = {
  id: 'spotify_get_shows',
  name: 'Spotify Get Multiple Shows',
  description: 'Get details for multiple podcast shows.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-playback-position'],
  },

  params: {
    showIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated show IDs (max 50)',
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
      const ids = params.showIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      let url = `https://api.spotify.com/v1/shows?ids=${ids}`
      if (params.market) url += `&market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetShowsResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        shows: (data.shows || []).map((show: any) => ({
          id: show.id,
          name: show.name,
          publisher: show.publisher || '',
          total_episodes: show.total_episodes || 0,
          image_url: show.images?.[0]?.url || null,
          external_url: show.external_urls?.spotify || '',
        })),
      },
    }
  },

  outputs: {
    shows: { type: 'json', description: 'List of shows' },
  },
}
