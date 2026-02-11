import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetShowParams {
  accessToken: string
  showId: string
  market?: string
}

interface SpotifyGetShowResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string
    publisher: string
    total_episodes: number
    explicit: boolean
    languages: string[]
    image_url: string | null
    external_url: string
  }
}

export const spotifyGetShowTool: ToolConfig<SpotifyGetShowParams, SpotifyGetShowResponse> = {
  id: 'spotify_get_show',
  name: 'Spotify Get Show',
  description: 'Get details for a podcast show.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-playback-position'],
  },

  params: {
    showId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify show ID',
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
      let url = `https://api.spotify.com/v1/shows/${params.showId}`
      if (params.market) url += `?market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetShowResponse> => {
    const show = await response.json()
    return {
      success: true,
      output: {
        id: show.id,
        name: show.name,
        description: show.description || '',
        publisher: show.publisher || '',
        total_episodes: show.total_episodes || 0,
        explicit: show.explicit || false,
        languages: show.languages || [],
        image_url: show.images?.[0]?.url || null,
        external_url: show.external_urls?.spotify || '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Show ID' },
    name: { type: 'string', description: 'Show name' },
    description: { type: 'string', description: 'Show description' },
    publisher: { type: 'string', description: 'Publisher name' },
    total_episodes: { type: 'number', description: 'Total episodes' },
    explicit: { type: 'boolean', description: 'Contains explicit content' },
    languages: { type: 'json', description: 'Languages' },
    image_url: { type: 'string', description: 'Cover image URL' },
    external_url: { type: 'string', description: 'Spotify URL' },
  },
}
