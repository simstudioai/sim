import type { VoyageAIRerankParams, VoyageAIRerankResponse } from '@/tools/voyageai/types'
import type { ToolConfig } from '@/tools/types'

export const rerankTool: ToolConfig<VoyageAIRerankParams, VoyageAIRerankResponse> = {
  id: 'voyageai_rerank',
  name: 'Voyage AI Rerank',
  description: 'Rerank documents by relevance to a query using Voyage AI reranking models',
  version: '1.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The query to rerank documents against',
    },
    documents: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of document strings to rerank',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Reranking model to use',
      default: 'rerank-2',
    },
    topK: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of top results to return',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Voyage AI API key',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://api.voyageai.com/v1/rerank',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const documents =
        typeof params.documents === 'string' ? JSON.parse(params.documents) : params.documents

      const body: Record<string, unknown> = {
        query: params.query,
        documents,
        model: params.model || 'rerank-2',
      }
      if (params.topK) {
        body.top_k = params.topK
      }
      return body
    },
  },

  transformResponse: async (response, params) => {
    const data = await response.json()
    const originalDocuments: string[] = params
      ? typeof params.documents === 'string'
        ? JSON.parse(params.documents)
        : params.documents
      : []

    return {
      success: true,
      output: {
        results: data.data.map((item: { index: number; relevance_score: number }) => ({
          index: item.index,
          relevance_score: item.relevance_score,
          document: originalDocuments[item.index] || '',
        })),
        model: data.model,
        usage: {
          total_tokens: data.usage.total_tokens,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Reranking results',
      properties: {
        results: {
          type: 'array',
          description: 'Reranked documents with relevance scores',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number', description: 'Original index of the document' },
              relevance_score: { type: 'number', description: 'Relevance score' },
              document: { type: 'string', description: 'Document text' },
            },
          },
        },
        model: { type: 'string', description: 'Model used for reranking' },
        usage: {
          type: 'object',
          description: 'Token usage information',
          properties: {
            total_tokens: { type: 'number', description: 'Total number of tokens used' },
          },
        },
      },
    },
  },
}
