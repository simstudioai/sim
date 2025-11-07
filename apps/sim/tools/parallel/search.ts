import type { ParallelSearchParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const searchTool: ToolConfig<ParallelSearchParams, ToolResponse> = {
  id: 'parallel_search',
  name: 'Parallel AI Search',
  description:
    'Search the web using Parallel AI. Provides comprehensive search results with intelligent processing and content extraction.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search objective or question to answer',
    },
    search_queries: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comma-separated list of search queries to execute',
    },
    processor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Processing method: base or pro (default: base)',
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 5)',
    },
    max_chars_per_result: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum characters per result (default: 1500)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Parallel AI API Key',
    },
  },

  request: {
    url: 'https://api.parallel.ai/v1beta/search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'parallel-beta': 'search-extract-2025-10-10',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        objective: params.objective,
      }

      // Only include search_queries if it's not empty
      if (
        params.search_queries !== undefined &&
        params.search_queries !== null &&
        params.search_queries.length > 0
      ) {
        body.search_queries = params.search_queries
      }

      // Add optional parameters if provided
      if (params.processor) body.processor = params.processor
      if (params.max_results) body.max_results = Number(params.max_results)
      if (params.max_chars_per_result)
        body.max_chars_per_result = Number(params.max_chars_per_result)

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        results: data.results.map((result: unknown) => {
          const resultObj = result as Record<string, unknown>
          return {
            url: resultObj.url || '',
            title: resultObj.title || '',
            excerpts: resultObj.excerpts || [],
          }
        }),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Search results with excerpts from relevant pages',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the search result' },
          title: { type: 'string', description: 'The title of the search result' },
          excerpts: {
            type: 'array',
            description: 'Text excerpts from the page',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}
