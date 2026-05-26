import type { BoChaSearchParams, BoChaSearchResponse } from '@/tools/bocha/types'
import {
  BOCHA_SEARCH_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/bocha/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<BoChaSearchParams, BoChaSearchResponse> = {
  id: 'bocha_search',
  name: 'BoCha Search',
  description:
    "Perform AI-powered web searches using BoCha's search API. Returns structured results with titles, URLs, snippets, and optional raw content, optimized for relevance and accuracy.",
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to execute (e.g., "latest AI research papers 2024")',
    },
    freshness: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search for web pages within a specified time range(noLimit/oneDay/oneWeek/oneMonth/oneYear/YYYY-MM-DD/YYYY-MM-DD/YYYY-MM-DD..YYYY-MM-DD).',
    },
    summary: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to display text summary.',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (1-50, e.g., 5)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specify the search scope by website domains. Multiple domains should be separated by | or ,, with a maximum limit of 100 domains.',
    },
    exclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude specified websites from search results. Multiple domains should be separated by | or ,, with a maximum limit of 100 domains.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'BoCha API Key',
    },
  },

  request: {
    url: 'https://api.bochaai.com/v1/web-search',
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
      if (params.freshness) body.freshness = params.freshness
      if (params.summary !== undefined) body.summary = params.summary
      if (params.count) body.count = Number(params.count)
      if (params.include) body.include = params.include
      if (params.exclude) body.exclude = params.exclude
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        query: data.data.queryContext.originalQuery,
        results: data.data.webPages.value.map((result: any) => ({
          title: result.name,
          url: result.url,
          snippet: result.snippet,
        })),
      },
    }
  },

  outputs: {
    query: { type: 'string', description: 'The search query that was executed' },
    results: {
      type: 'array',
      description:
        'Ranked search results with titles, URLs, content snippets',
      items: {
        type: 'object',
        properties: BOCHA_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
  },
}
