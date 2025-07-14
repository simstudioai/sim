import type { ToolConfig } from '../types'
import type { TavilySearchParams, TavilySearchResponse } from './types'

export const searchTool: ToolConfig<TavilySearchParams, TavilySearchResponse> = {
  id: 'tavily_search',
  name: 'Tavily Search',
  description:
    "Perform AI-powered web searches using Tavily's search API. Returns structured results with titles, URLs, snippets, and optional raw content, optimized for relevance and accuracy.",
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to execute',
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results (1-20)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tavily API Key',
    },
  },

  request: {
    url: 'https://api.tavily.com/search',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Only include optional parameters if explicitly set
      if (params.max_results) body.max_results = params.max_results

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Failed to perform search')
    }

    return {
      success: true,
      output: {
        query: data.query,
        results: data.results.map((result: any) => ({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          ...(result.raw_content && { raw_content: result.raw_content }),
        })),
        response_time: data.response_time,
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while performing the search'
  },
}
