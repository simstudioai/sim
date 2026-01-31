import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetAudiobookChaptersParams {
  accessToken: string
  audiobookId: string
  limit?: number
  offset?: number
  market?: string
}

interface SpotifyGetAudiobookChaptersResponse extends ToolResponse {
  output: {
    chapters: Array<{
      id: string
      name: string
      chapter_number: number
      duration_ms: number
      image_url: string | null
      external_url: string
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetAudiobookChaptersTool: ToolConfig<
  SpotifyGetAudiobookChaptersParams,
  SpotifyGetAudiobookChaptersResponse
> = {
  id: 'spotify_get_audiobook_chapters',
  name: 'Spotify Get Audiobook Chapters',
  description: 'Get chapters from an audiobook.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-playback-position'],
  },

  params: {
    audiobookId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Spotify audiobook ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of chapters to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of first chapter to return for pagination',
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
      let url = `https://api.spotify.com/v1/audiobooks/${params.audiobookId}/chapters?limit=${limit}&offset=${offset}`
      if (params.market) url += `&market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetAudiobookChaptersResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        chapters: (data.items || []).map((ch: any) => ({
          id: ch.id,
          name: ch.name,
          chapter_number: ch.chapter_number || 0,
          duration_ms: ch.duration_ms || 0,
          image_url: ch.images?.[0]?.url || null,
          external_url: ch.external_urls?.spotify || '',
        })),
        total: data.total || 0,
        next: data.next || null,
      },
    }
  },

  outputs: {
    chapters: { type: 'json', description: 'List of chapters' },
    total: { type: 'number', description: 'Total chapters' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
