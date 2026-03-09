import type { ToolConfig } from '@/tools/types'
import type { ObsidianSearchParams, ObsidianSearchResponse } from './types'

export const searchTool: ToolConfig<ObsidianSearchParams, ObsidianSearchResponse> = {
  id: 'obsidian_search',
  name: 'Obsidian Search',
  description: 'Search for text across notes in your Obsidian vault',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key from Obsidian Local REST API plugin settings',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Base URL for the Obsidian Local REST API',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text to search for across vault notes',
    },
    contextLength: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of characters of context around each match (default: 100)',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      const contextParam = params.contextLength ? `&contextLength=${params.contextLength}` : ''
      return `${base}/search/simple/?query=${encodeURIComponent(params.query)}${contextParam}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Search failed: ${error.message ?? response.statusText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        results:
          data?.map(
            (item: {
              filename: string
              score: number
              matches: Array<{ match: { start: number; end: number }; context: string }>
            }) => ({
              filename: item.filename ?? '',
              score: item.score ?? 0,
              matches:
                item.matches?.map((m: { context: string }) => ({
                  context: m.context ?? '',
                })) ?? [],
            })
          ) ?? [],
      },
    }
  },

  outputs: {
    results: {
      type: 'json',
      description: 'Search results with filenames, scores, and matching contexts',
      properties: {
        filename: { type: 'string', description: 'Path to the matching note' },
        score: { type: 'number', description: 'Relevance score' },
        matches: {
          type: 'json',
          description: 'Matching text contexts',
          properties: {
            context: { type: 'string', description: 'Text surrounding the match' },
          },
        },
      },
    },
  },
}
