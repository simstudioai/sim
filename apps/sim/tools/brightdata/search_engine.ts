import type { SearchEngineParams, SearchEngineResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data search engine tool.
 */
export const searchEngineTool: ToolConfig<SearchEngineParams, SearchEngineResponse> = {
  id: 'brightdata_search_engine',
  name: 'Bright Data Search Engine',
  description: 'Search the web using Bright Data search engine',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 10)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    unlockerZone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bright Data unlocker zone name',
    },
  },

  request: {
    method: 'POST',
    url: '/api/tools/brightdata/search-engine',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      query: params.query,
      maxResults: params.maxResults || 10,
      apiToken: params.apiToken,
      unlockerZone: params.unlockerZone || 'mcp_unlocker',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Bright Data search failed')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Search results with title, URL, and snippet',
    },
  },
}
