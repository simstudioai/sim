import type { ToolConfig } from '../types'
import type { SearchParams, SearchResponse } from './types'

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

    if (!data.success) {
      throw new Error(data.error?.message || 'Unknown error occurred')
    }

    return {
      success: true,
      output: {
        data: data.data,
        warning: data.warning,
      },
    }
  },

  transformError: (error) => {
    const message = error.error?.message || error.message
    const code = error.error?.type || error.code
    return `${message} (${code})`
  },
}
