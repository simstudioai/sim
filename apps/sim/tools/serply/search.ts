import type { OutputProperty, ToolConfig, ToolResponse } from '@/tools/types'

export const SERPLY_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Result title' },
  link: { type: 'string', description: 'Result URL' },
  snippet: { type: 'string', description: 'Result description/snippet', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface SearchParams {
  query: string
  apiKey: string
  num?: number
}

export interface SearchResult {
  title: string
  link: string
  snippet?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    searchResults: SearchResult[]
  }
}

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'serply_search',
  name: 'Web Search',
  description:
    'A web search tool that provides access to Google search results through the Serply SERP API. Returns organic results with titles, links, and snippets.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query (e.g., "latest AI news", "best restaurants in NYC")',
    },
    num: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 20, 50)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Serply API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.serply.io/v1/search/')
      url.searchParams.set('q', params.query)
      if (params.num) url.searchParams.set('num', String(Number(params.num)))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      Accept: 'application/json',
      // Serply sits behind Cloudflare, which rejects requests without an
      // explicit User-Agent, so always send one.
      'User-Agent': 'sim-serply-tool',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const results = Array.isArray(data.results) ? data.results : []

    const searchResults: SearchResult[] = results.map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.description || undefined,
    }))

    return {
      success: true,
      output: { searchResults },
    }
  },

  outputs: {
    searchResults: {
      type: 'array',
      description: 'Organic search results with titles, links, and snippets',
      items: { type: 'object', properties: SERPLY_SEARCH_RESULT_OUTPUT_PROPERTIES },
    },
  },
}
