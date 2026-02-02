import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetAudiobooksParams {
  accessToken: string
  audiobookIds: string
  market?: string
}

interface SpotifyGetAudiobooksResponse extends ToolResponse {
  output: {
    audiobooks: Array<{
      id: string
      name: string
      authors: Array<{ name: string }>
      total_chapters: number
      image_url: string | null
      external_url: string
    }>
  }
}

export const spotifyGetAudiobooksTool: ToolConfig<
  SpotifyGetAudiobooksParams,
  SpotifyGetAudiobooksResponse
> = {
  id: 'spotify_get_audiobooks',
  name: 'Spotify Get Multiple Audiobooks',
  description: 'Get details for multiple audiobooks.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-playback-position'],
  },

  params: {
    audiobookIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated audiobook IDs (max 50)',
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
      const ids = params.audiobookIds
        .split(',')
        .map((id) => id.trim())
        .slice(0, 50)
        .join(',')
      let url = `https://api.spotify.com/v1/audiobooks?ids=${ids}`
      if (params.market) url += `&market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetAudiobooksResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        audiobooks: (data.audiobooks || []).map((book: any) => ({
          id: book.id,
          name: book.name,
          authors: book.authors || [],
          total_chapters: book.total_chapters || 0,
          image_url: book.images?.[0]?.url || null,
          external_url: book.external_urls?.spotify || '',
        })),
      },
    }
  },

  outputs: {
    audiobooks: { type: 'json', description: 'List of audiobooks' },
  },
}
