import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetSavedEpisodesParams {
  accessToken: string
  limit?: number
  offset?: number
  market?: string
}

interface SpotifyGetSavedEpisodesResponse extends ToolResponse {
  output: {
    episodes: Array<{
      added_at: string
      episode: {
        id: string
        name: string
        duration_ms: number
        release_date: string
        show: { id: string; name: string }
        image_url: string | null
        external_url: string
      }
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetSavedEpisodesTool: ToolConfig<
  SpotifyGetSavedEpisodesParams,
  SpotifyGetSavedEpisodesResponse
> = {
  id: 'spotify_get_saved_episodes',
  name: 'Spotify Get Saved Episodes',
  description: "Get the user's saved podcast episodes.",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-library-read', 'user-read-playback-position'],
  },

  params: {
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
      let url = `https://api.spotify.com/v1/me/episodes?limit=${limit}&offset=${offset}`
      if (params.market) url += `&market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetSavedEpisodesResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        episodes: (data.items || []).map((item: any) => ({
          added_at: item.added_at,
          episode: {
            id: item.episode.id,
            name: item.episode.name,
            duration_ms: item.episode.duration_ms || 0,
            release_date: item.episode.release_date || '',
            show: { id: item.episode.show?.id || '', name: item.episode.show?.name || '' },
            image_url: item.episode.images?.[0]?.url || null,
            external_url: item.episode.external_urls?.spotify || '',
          },
        })),
        total: data.total || 0,
        next: data.next || null,
      },
    }
  },

  outputs: {
    episodes: { type: 'json', description: 'List of saved episodes' },
    total: { type: 'number', description: 'Total saved episodes' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
