import type { ToolConfig } from '../types'
import type { KnowledgeSearchResponse } from './types'

export const knowledgeSearchTool: ToolConfig<any, KnowledgeSearchResponse> = {
  id: 'knowledge_search',
  name: 'Knowledge Search',
  description: 'Search for similar content in one or more knowledge bases using vector similarity',
  version: '1.0.0',
  params: {
    knowledgeBaseIds: {
      type: 'string',
      required: true,
      description:
        'ID of the knowledge base to search in, or comma-separated IDs for multiple knowledge bases',
    },
    query: {
      type: 'string',
      required: true,
      description: 'Search query text',
    },
    topK: {
      type: 'number',
      required: false,
      description: 'Number of most similar results to return (1-100)',
    },
    tag1: {
      type: 'string',
      required: false,
      description: 'Filter by tag 1 value',
    },
    tag2: {
      type: 'string',
      required: false,
      description: 'Filter by tag 2 value',
    },
    tag3: {
      type: 'string',
      required: false,
      description: 'Filter by tag 3 value',
    },
    tag4: {
      type: 'string',
      required: false,
      description: 'Filter by tag 4 value',
    },
    tag5: {
      type: 'string',
      required: false,
      description: 'Filter by tag 5 value',
    },
    tag6: {
      type: 'string',
      required: false,
      description: 'Filter by tag 6 value',
    },
    tag7: {
      type: 'string',
      required: false,
      description: 'Filter by tag 7 value',
    },
  },
  request: {
    url: () => '/api/knowledge/search',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const workflowId = params._context?.workflowId

      // Handle multiple knowledge base IDs
      let knowledgeBaseIds = params.knowledgeBaseIds
      if (typeof knowledgeBaseIds === 'string' && knowledgeBaseIds.includes(',')) {
        // Split comma-separated string into array
        knowledgeBaseIds = knowledgeBaseIds
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      }

      // Build filters object from tag parameters
      const filters: Record<string, string> = {}
      if (params.tag1) filters.tag1 = params.tag1.toString()
      if (params.tag2) filters.tag2 = params.tag2.toString()
      if (params.tag3) filters.tag3 = params.tag3.toString()
      if (params.tag4) filters.tag4 = params.tag4.toString()
      if (params.tag5) filters.tag5 = params.tag5.toString()
      if (params.tag6) filters.tag6 = params.tag6.toString()
      if (params.tag7) filters.tag7 = params.tag7.toString()

      const requestBody = {
        knowledgeBaseIds,
        query: params.query,
        topK: params.topK
          ? Math.max(1, Math.min(100, Number.parseInt(params.topK.toString()) || 10))
          : 10,
        ...(Object.keys(filters).length > 0 && { filters }),
        ...(workflowId && { workflowId }),
      }

      return requestBody
    },
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<KnowledgeSearchResponse> => {
    try {
      const result = await response.json()

      if (!response.ok) {
        const errorMessage =
          result.error?.message || result.message || 'Failed to perform vector search'
        throw new Error(errorMessage)
      }

      const data = result.data || result

      return {
        success: true,
        output: {
          results: data.results || [],
          query: data.query,
          totalResults: data.totalResults || 0,
          cost: data.cost,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          results: [],
          query: '',
          totalResults: 0,
          cost: undefined,
        },
        error: `Vector search failed: ${error.message || 'Unknown error'}`,
      }
    }
  },
  transformError: async (error): Promise<KnowledgeSearchResponse> => {
    const errorMessage = `Vector search failed: ${error.message || 'Unknown error'}`
    return {
      success: false,
      output: {
        results: [],
        query: '',
        totalResults: 0,
        cost: undefined,
      },
      error: errorMessage,
    }
  },
}
