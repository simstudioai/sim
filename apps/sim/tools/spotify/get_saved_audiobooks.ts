import type { ToolConfig, ToolResponse } from '@/tools/types'

interface SpotifyGetSavedAudiobooksParams {
  accessToken: string
  limit?: number
  offset?: number
}

interface SpotifyGetSavedAudiobooksResponse extends ToolResponse {
  output: {
    audiobooks: Array<{
      added_at: string
      audiobook: {
        id: string
        name: string
        authors: Array<{ name: string }>
        total_chapters: number
        image_url: string | null
        external_url: string
      }
    }>
    total: number
    next: string | null
  }
}

export const spotifyGetSavedAudiobooksTool: ToolConfig<
  SpotifyGetSavedAudiobooksParams,
  SpotifyGetSavedAudiobooksResponse
> = {
  id: 'spotify_get_saved_audiobooks',
  name: 'Spotify Get Saved Audiobooks',
  description: "Get the user's saved audiobooks.",
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
      description: 'Number of audiobooks to return (1-50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Index of first audiobook to return for pagination',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      const offset = params.offset || 0
      return `https://api.spotify.com/v1/me/audiobooks?limit=${limit}&offset=${offset}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetSavedAudiobooksResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        audiobooks: (data.items || []).map((item: any) => ({
          added_at: item.added_at,
          audiobook: {
            id: item.audiobook?.id || item.id,
            name: item.audiobook?.name || item.name,
            authors: item.audiobook?.authors || item.authors || [],
            total_chapters: item.audiobook?.total_chapters || item.total_chapters || 0,
            image_url: item.audiobook?.images?.[0]?.url || item.images?.[0]?.url || null,
            external_url:
              item.audiobook?.external_urls?.spotify || item.external_urls?.spotify || '',
          },
        })),
        total: data.total || 0,
        next: data.next || null,
      },
    }
  },

  outputs: {
    audiobooks: { type: 'json', description: 'List of saved audiobooks' },
    total: { type: 'number', description: 'Total saved audiobooks' },
    next: { type: 'string', description: 'URL for next page', optional: true },
  },
}
