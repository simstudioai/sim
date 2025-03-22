import { ToolConfig, ToolResponse } from '../types'

interface SearchParams {
  query: string
  apiKey: string
  max_results?: number
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  raw_content?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    query: string
    results: SearchResult[]
    response_time: number
  }
}

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'tavily_search',
  name: 'Tavily Search',
  description:
    "Perform AI-powered web searches using Tavily's search API. Returns structured results with titles, URLs, snippets, and optional raw content, optimized for relevance and accuracy.",
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      description: 'The search query to execute',
    },
    max_results: {
      type: 'number',
      required: false,
      description: 'Maximum number of results (1-20)',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
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
