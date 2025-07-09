import type { ToolConfig } from '../types'

export interface DocsSearchParams {
  query: string
  topK?: number
}

export interface DocsSearchResponse {
  success: boolean
  output: {
    response: string
    sources: Array<{
      title: string
      document: string
      link: string
      similarity: number
    }>
  }
  error?: string
}

export const docsSearchTool: ToolConfig<DocsSearchParams, DocsSearchResponse> = {
  id: 'docs_search_internal',
  name: 'Search Documentation',
  description: 'Search Sim Studio documentation using vector similarity search',
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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to search documentation')
    }

    return {
      success: true,
      output: {
        response: data.response,
        sources: data.sources || [],
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while searching documentation'
  },
} 