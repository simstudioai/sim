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
    url: 'https://api.firecrawl.dev/v2/search',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Add all optional parameters if provided
      if (params.limit !== undefined) body.limit = Number(params.limit)
      if (params.sources !== undefined) body.sources = params.sources
      if (params.categories !== undefined) body.categories = params.categories
      if (params.tbs !== undefined) body.tbs = params.tbs
      if (params.location !== undefined) body.location = params.location
      if (params.country !== undefined) body.country = params.country
      if (params.timeout !== undefined) body.timeout = Number(params.timeout)
      if (params.ignoreInvalidURLs !== undefined) body.ignoreInvalidURLs = params.ignoreInvalidURLs
      if (params.scrapeOptions !== undefined) body.scrapeOptions = params.scrapeOptions

      return body
    },
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
