import type { ToolConfig } from '@/tools/types'

export const yandexMusicSearchAlbumsTool: ToolConfig = {
  id: 'yandex_music_search_albums',
  name: 'Search Albums by Query',
  description: 'Searches the catalog specifically for albums matching a query.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search term (e.g., album name or artist).',
    },
    year_range: {
      type: 'json',
      visibility: 'user-or-llm',
      description: 'Filter by release year range (e.g., {start: 2010, end: 2015}).',
    },
  },

  outputs: {
    albums: {
      type: 'array',
      description: 'List of matching album objects.',
    },
    total_results: {
      type: 'string',
      description: 'Total number of albums found globally for the query.',
      optional: true,
    },
  },

  request: {
    url: () => `https://api.yandex.ru/music/v1/v1/albums/search`,
    method: () => 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),

  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      albums: data.albums ?? null,
      total_results: data.total_results ?? 0,
    }
  },
}
