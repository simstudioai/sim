import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetShowEpisodesParams {
  accessToken: string
  showId: string
  limit?: number
  offset?: number
  market?: string
}

interface SpotifyGetShowEpisodesResponse extends ToolResponse {
  output: {
    episodes: Array<{
      id: string
      name: string
      description: string
      duration_ms: number
      release_date: string
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetShowEpisodesTool: ToolConfig<
  SpotifyGetShowEpisodesParams,
  SpotifyGetShowEpisodesResponse
> = {
  id: 'spotify_get_show_episodes',
  name: 'Spotify Get Show Episodes',
  description: 'Get episodes from a podcast show.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of episodes to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of first episode to return for pagination',
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
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      let url = `https://api.spotify.com/v1/shows/${params.showId}/episodes?limit=${limit}&offset=${offset}`
      if (params.market) url += `&market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetShowEpisodesResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        episodes: (data.items || []).map((ep: any) => ({
          id: ep.id,
          name: ep.name,
          description: ep.description || '',
          duration_ms: ep.duration_ms || 0,
          release_date: ep.release_date || '',
          image_url: ep.images?.[0]?.url || null,
          external_url: ep.external_urls?.spotify || '',
        })),
        total: data.total || 0,
        next: data.next || null,
      },
    }
  },

  outputs: {
    episodes: { type: 'json', description: 'List of episodes' },
    total: { type: 'number', description: 'Total episodes' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
