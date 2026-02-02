import type { SearchParams, SearchResponse } from '@/tools/search/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'search_tool',
  name: 'Web Search',
  description:
    'Search the web. Returns the most relevant web results, including title, link, snippet, and date for each result.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query',
    },
  },

  request: {
    url: () => '/api/tools/search',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      query: params.query,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: data,
    }
  },
}
