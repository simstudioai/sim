import type { KnowledgeSearchResponse } from '@/tools/knowledge/types'
import { enrichKBTagFiltersSchema } from '@/tools/schema-enrichers'
import { parseTagFilters } from '@/tools/shared/tags'
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
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base to search in',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query text (optional when using tag filters)',
    },
    topK: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of most similar results to return (1-100)',
    },
    tagFilters: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of tag filters with tagName and tagValue properties',
      items: {
        type: 'object',
        properties: {
          tagName: { type: 'string' },
          tagValue: { type: 'string' },
        },
      },
    },
  },

  schemaEnrichment: {
    tagFilters: {
      dependsOn: 'knowledgeBaseId',
      enrichSchema: enrichKBTagFiltersSchema,
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

      // Parse tag filters from various formats (array, JSON string)
      const structuredFilters = parseTagFilters(params.tagFilters)

      const requestBody = {
        knowledgeBaseIds,
        query: params.query,
        topK: params.topK ? Math.max(1, Math.min(100, Number(params.topK))) : 10,
        ...(structuredFilters.length > 0 && { tagFilters: structuredFilters }),
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
