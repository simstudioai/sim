import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetSavedShowsParams {
  accessToken: string
  limit?: number
  offset?: number
}

interface SpotifyGetSavedShowsResponse extends ToolResponse {
  output: {
    shows: Array<{
      added_at: string
      show: {
        id: string
        name: string
        publisher: string
        total_episodes: number
        image_url: string | null
        external_url: string
      }
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetSavedShowsTool: ToolConfig<
  SpotifyGetSavedShowsParams,
  SpotifyGetSavedShowsResponse
> = {
  id: 'spotify_get_saved_shows',
  name: 'Spotify Get Saved Shows',
  description: "Get the user's saved podcast shows.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read'],
  },

  params: {
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of shows to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of first show to return for pagination',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      return `https://api.spotify.com/v1/me/shows?limit=${limit}&offset=${offset}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetSavedShowsResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        shows: (data.items || []).map((item: any) => ({
          added_at: item.added_at,
          show: {
            id: item.show.id,
            name: item.show.name,
            publisher: item.show.publisher || '',
            total_episodes: item.show.total_episodes || 0,
            image_url: item.show.images?.[0]?.url || null,
            external_url: item.show.external_urls?.spotify || '',
          },
        })),
        total: data.total || 0,
        next: data.next || null,
      },
    }
  },

  outputs: {
    shows: { type: 'json', description: 'List of saved shows' },
    total: { type: 'number', description: 'Total saved shows' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
