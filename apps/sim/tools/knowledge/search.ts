import type { KnowledgeSearchResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

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
      required: false,
      description: 'Search query text (optional when using tag filters)',
    },
    topK: {
      type: 'number',
      required: false,
      description: 'Number of most similar results to return (1-100)',
    },
    tagFilters: {
      type: 'any',
      required: false,
      description: 'Array of tag filters with tagName and tagValue properties',
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

      // Use single knowledge base ID
      const knowledgeBaseIds = [params.knowledgeBaseId]

      // Parse dynamic tag filters and send display names to API
      const filters: Record<string, string> = {}
      if (params.tagFilters) {
        let tagFilters = params.tagFilters

        // Handle both string (JSON) and array formats
        if (typeof tagFilters === 'string') {
          try {
            tagFilters = JSON.parse(tagFilters)
          } catch (error) {
            tagFilters = []
          }
        }

        if (Array.isArray(tagFilters)) {
          // Group filters by tag name for OR logic within same tag
          const groupedFilters: Record<string, string[]> = {}
          tagFilters.forEach((filter: any) => {
            if (filter.tagName && filter.tagValue && filter.tagValue.trim().length > 0) {
              if (!groupedFilters[filter.tagName]) {
                groupedFilters[filter.tagName] = []
              }
              groupedFilters[filter.tagName].push(filter.tagValue)
            }
          })

          // Convert to filters format - for now, join multiple values with OR separator
          Object.entries(groupedFilters).forEach(([tagName, values]) => {
            filters[tagName] = values.join('|OR|') // Use special separator for OR logic
          })
        }
      }

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
  },
  transformResponse: async (response): Promise<KnowledgeSearchResponse> => {
    const result = await response.json()
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
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of search results from the knowledge base',
      items: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Document ID' },
          documentName: { type: 'string', description: 'Document name' },
          content: { type: 'string', description: 'Content of the result' },
          chunkIndex: { type: 'number', description: 'Index of the chunk within the document' },
          similarity: { type: 'number', description: 'Similarity score of the result' },
          metadata: { type: 'object', description: 'Metadata of the result, including tags' },
        },
      },
    },
    query: {
      type: 'string',
      description: 'The search query that was executed',
    },
    totalResults: {
      type: 'number',
      description: 'Total number of results found',
    },
    cost: {
      type: 'object',
      description: 'Cost information for the search operation',
      optional: true,
    },
  },
}
