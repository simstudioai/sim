import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetEpisodesParams {
  accessToken: string
  episodeIds: string
  market?: string
}

interface SpotifyGetEpisodesResponse extends ToolResponse {
  output: {
    episodes: Array<{
      id: string
      name: string
      description: string
      duration_ms: number
      release_date: string
      show: { id: string; name: string }
      image_url: string | null
      external_url: string
    }>
  }
}

export const spotifyGetEpisodesTool: ToolConfig<
  SpotifyGetEpisodesParams,
  SpotifyGetEpisodesResponse
> = {
  id: 'spotify_get_episodes',
  name: 'Spotify Get Multiple Episodes',
  description: 'Get details for multiple podcast episodes.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-playback-position'],
  },

  params: {
    episodeIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated episode IDs (max 50)',
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
      const ids = params.episodeIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      let url = `https://api.spotify.com/v1/episodes?ids=${ids}`
      if (params.market) url += `&market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetEpisodesResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        episodes: (data.episodes || []).map((ep: any) => ({
          id: ep.id,
          name: ep.name,
          description: ep.description || '',
          duration_ms: ep.duration_ms || 0,
          release_date: ep.release_date || '',
          show: { id: ep.show?.id || '', name: ep.show?.name || '' },
          image_url: ep.images?.[0]?.url || null,
          external_url: ep.external_urls?.spotify || '',
        })),
      },
    }
  },

  outputs: {
    episodes: { type: 'json', description: 'List of episodes' },
  },
}
