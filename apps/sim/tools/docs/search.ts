import type { ToolConfig } from '../types'

export interface DocsSearchParams {
  query: string
  topK?: number
}

export interface DocsSearchResponse {
  results: Array<{
    id: number
    title: string
    url: string
    content: string
    similarity: number
  }>
  query: string
  totalResults: number
}

export const docsSearchTool: ToolConfig<DocsSearchParams, DocsSearchResponse> = {
  id: 'docs_search_internal',
  name: 'Search Documentation',
  description:
    'Search Sim Studio documentation for information about features, tools, workflows, and functionality',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      description: 'The search query to find relevant documentation',
    },
    topK: {
      type: 'number',
      required: false,
      description: 'Number of results to return (default: 5, max: 10)',
      default: 5,
    },
  },

  request: {
    url: '/api/docs/search',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      query: params.query,
      topK: params.topK || 5,
    }),
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<any> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {},
        error: data.error || 'Failed to search documentation',
      }
    }

    return {
      success: true,
      output: {
        results: data.results || [],
        query: data.query || '',
        totalResults: data.totalResults || 0,
      },
    }
  },
}
