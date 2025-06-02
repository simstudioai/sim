import type { ToolConfig } from '../types'
import type { KnowledgeSearchResponse } from './types'

export const knowledgeSearchTool: ToolConfig<any, KnowledgeSearchResponse> = {
  id: 'knowledge_search',
  name: 'Knowledge Search',
  description: 'Search for similar content in a knowledge base using vector similarity',
  version: '1.0.0',
  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      description: 'ID of the knowledge base to search in',
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
  },
  request: {
    url: () => '/api/knowledge/search',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      knowledgeBaseId: params.knowledgeBaseId,
      query: params.query,
      topK: params.topK ? Number.parseInt(params.topK.toString()) : 10,
    }),
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
          knowledgeBaseId: data.knowledgeBaseId,
          topK: data.topK,
          totalResults: data.totalResults || 0,
          message: `Found ${data.totalResults || 0} similar results`,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          results: [],
          query: '',
          knowledgeBaseId: '',
          topK: 0,
          totalResults: 0,
          message: `Vector search failed: ${error.message || 'Unknown error'}`,
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
        knowledgeBaseId: '',
        topK: 0,
        totalResults: 0,
        message: errorMessage,
      },
      error: errorMessage,
    }
  },
}
