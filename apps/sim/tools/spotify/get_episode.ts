import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetEpisodeParams {
  accessToken: string
  episodeId: string
  market?: string
}

interface SpotifyGetEpisodeResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string
    duration_ms: number
    release_date: string
    explicit: boolean
    show: { id: string; name: string; publisher: string }
    image_url: string | null
    external_url: string
  }
}

export const spotifyGetEpisodeTool: ToolConfig<SpotifyGetEpisodeParams, SpotifyGetEpisodeResponse> =
  {
    id: 'spotify_get_episode',
    name: 'Spotify Get Episode',
    description: 'Get details for a podcast episode.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'spotify',
      requiredScopes: ['user-read-playback-position'],
    },

    params: {
      episodeId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The Spotify episode ID',
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
        let url = `https://api.spotify.com/v1/episodes/${params.episodeId}`
        if (params.market) url += `?market=${params.market}`
        return url
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response): Promise<SpotifyGetEpisodeResponse> => {
      const ep = await response.json()
      return {
        success: true,
        output: {
          id: ep.id,
          name: ep.name,
          description: ep.description || '',
          duration_ms: ep.duration_ms || 0,
          release_date: ep.release_date || '',
          explicit: ep.explicit || false,
          show: {
            id: ep.show?.id || '',
            name: ep.show?.name || '',
            publisher: ep.show?.publisher || '',
          },
          image_url: ep.images?.[0]?.url || null,
          external_url: ep.external_urls?.spotify || '',
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Episode ID' },
      name: { type: 'string', description: 'Episode name' },
      description: { type: 'string', description: 'Episode description' },
      duration_ms: { type: 'number', description: 'Duration in ms' },
      release_date: { type: 'string', description: 'Release date' },
      explicit: { type: 'boolean', description: 'Contains explicit content' },
      show: { type: 'json', description: 'Parent show info' },
      image_url: { type: 'string', description: 'Cover image URL' },
      external_url: { type: 'string', description: 'Spotify URL' },
    },
  }
