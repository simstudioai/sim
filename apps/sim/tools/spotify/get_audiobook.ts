import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetAudiobookParams {
  accessToken: string
  audiobookId: string
  market?: string
}

interface SpotifyGetAudiobookResponse extends ToolResponse {
  output: {
    id: string
    name: string
    authors: Array<{ name: string }>
    narrators: Array<{ name: string }>
    publisher: string
    description: string
    total_chapters: number
    languages: string[]
    image_url: string | null
    external_url: string
  }
}

export const spotifyGetAudiobookTool: ToolConfig<
  SpotifyGetAudiobookParams,
  SpotifyGetAudiobookResponse
> = {
  id: 'spotify_get_audiobook',
  name: 'Spotify Get Audiobook',
  description: 'Get details for an audiobook.',
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
    market: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "GB")',
    },
  },

  request: {
    url: (params) => {
      let url = `https://api.spotify.com/v1/audiobooks/${params.audiobookId}`
      if (params.market) url += `?market=${params.market}`
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetAudiobookResponse> => {
    const book = await response.json()
    return {
      success: true,
      output: {
        id: book.id,
        name: book.name,
        authors: book.authors || [],
        narrators: book.narrators || [],
        publisher: book.publisher || '',
        description: book.description || '',
        total_chapters: book.total_chapters || 0,
        languages: book.languages || [],
        image_url: book.images?.[0]?.url || null,
        external_url: book.external_urls?.spotify || '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Audiobook ID' },
    name: { type: 'string', description: 'Audiobook name' },
    authors: { type: 'json', description: 'Authors' },
    narrators: { type: 'json', description: 'Narrators' },
    publisher: { type: 'string', description: 'Publisher' },
    description: { type: 'string', description: 'Description' },
    total_chapters: { type: 'number', description: 'Total chapters' },
    languages: { type: 'json', description: 'Languages' },
    image_url: { type: 'string', description: 'Cover image URL' },
    external_url: { type: 'string', description: 'Spotify URL' },
  },
}
