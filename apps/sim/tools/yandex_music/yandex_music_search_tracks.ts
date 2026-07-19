import type { ToolConfig } from '@/tools/types'

export const yandexMusicSearchTracksTool: ToolConfig = {
  id: 'yandex_music_search_tracks',
  name: 'Search Tracks by Query',
  description:
    'Searches the entire music catalog for tracks matching a given query string, allowing filtering by artist or genre.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The search term (e.g., 'song name' or 'artist name').",
    },
    limit: {
      type: 'string',
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return.',
    },
  },

  outputs: {
    tracks: {
      type: 'array',
      description: 'List of matching track objects.',
    },
    total_results: {
      type: 'string',
      description: 'Total number of tracks found globally for the query.',
      optional: true,
    },
  },

  request: {
    url: () => `https://api.yandex.ru/music/v1/v1/tracks/search`,
    method: () => 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      tracks: data.tracks ?? null,
      total_results: data.total_results ?? 0,
    }
  },
}
