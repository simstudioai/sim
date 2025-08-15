import type { SearchParams, SearchResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'firecrawl_search',
  name: 'Firecrawl Search',
  description: 'Search for information on the web using Firecrawl',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to use',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.firecrawl.dev/v1/search',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      query: params.query,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        data: data.data,
        warning: data.warning,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Search results data',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          url: { type: 'string' },
          markdown: { type: 'string' },
          html: { type: 'string' },
          rawHtml: { type: 'string' },
          links: { type: 'array' },
          screenshot: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
    warning: { type: 'string', description: 'Warning messages from the search operation' },
  },
}
