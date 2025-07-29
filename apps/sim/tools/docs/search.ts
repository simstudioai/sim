import type { ToolConfig, ToolResponse } from '@/tools/types'

interface DocsSearchParams {
  query: string
  topK?: number
}

interface DocsSearchResult {
  id: string
  title: string
  content: string
  url: string
  score: number
  metadata?: Record<string, any>
}

interface DocsSearchResponse extends ToolResponse {
  output: {
    results: DocsSearchResult[]
    query: string
    totalResults: number
    searchTime: number
  }
}

export const docsSearchTool: ToolConfig<DocsSearchParams, DocsSearchResponse> = {
  id: 'docs_search_internal',
  name: 'Search Documentation',
  description:
    'Search Sim documentation for information about features, tools, workflows, and functionality',
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
      description: 'Number of results to return (default: 10, max: 20)',
    },
  },

  request: {
    url: '/api/docs/search',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Validate and clamp topK parameter
      let topK = params.topK || 10
      if (topK > 20) topK = 20
      if (topK < 1) topK = 1

      return {
        query: params.query,
        topK,
      }
    },
    isInternalRoute: true,
  },

  transformResponse: async (
    response: Response,
    params?: DocsSearchParams
  ): Promise<DocsSearchResponse> => {
    if (!response.ok) {
      throw new Error(`Docs search failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    // Validate and transform the API response
    const results: DocsSearchResult[] = (data.results || []).map((result: any) => ({
      id: result.id || '',
      title: result.title || 'Untitled',
      content: result.content || '',
      url: result.url || '',
      score: typeof result.score === 'number' ? result.score : 0,
      metadata: result.metadata || {},
    }))

    return {
      success: true,
      output: {
        results,
        query: params?.query || '',
        totalResults: results.length,
        searchTime: data.searchTime || 0,
      },
    }
  },

  transformError: (error: any): string => {
    if (error instanceof Error) {
      return `Documentation search failed: ${error.message}`
    }
    return 'An unexpected error occurred while searching documentation'
  },
}
