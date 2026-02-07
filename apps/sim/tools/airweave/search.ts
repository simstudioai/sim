import type { AirweaveSearchParams, AirweaveSearchResponse } from '@/tools/airweave/types'
import { AIRWEAVE_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/airweave/types'
import type { ToolConfig } from '@/tools/types'

export const airweaveSearchTool: ToolConfig<AirweaveSearchParams, AirweaveSearchResponse> = {
  id: 'airweave_search',
  name: 'Airweave Search',
  description:
    'Search your synced data collections using Airweave. Supports semantic search with hybrid, neural, or keyword retrieval strategies. Optionally generate AI-powered answers from search results.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Airweave API Key for authentication',
    },
    collectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The readable ID of the collection to search',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query text',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 100)',
    },
    retrievalStrategy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retrieval strategy: hybrid (default), neural, or keyword',
    },
    expandQuery: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Generate query variations to improve recall',
    },
    rerank: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reorder results for improved relevance using LLM',
    },
    generateAnswer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Generate a natural-language answer to the query',
    },
  },

  request: {
    url: (params) => `https://api.airweave.ai/collections/${params.collectionId}/search`,
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Only include optional parameters if explicitly set
      if (params.limit !== undefined) body.limit = Number(params.limit)
      if (params.retrievalStrategy) body.retrieval_strategy = params.retrievalStrategy
      if (params.expandQuery !== undefined) body.expand_query = params.expandQuery
      if (params.rerank !== undefined) body.rerank = params.rerank
      if (params.generateAnswer !== undefined) body.generate_answer = params.generateAnswer

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Handle error responses
    if (!response.ok) {
      return {
        success: false,
        output: { results: [] },
        error: data.detail ?? data.message ?? 'Search request failed',
      }
    }

    return {
      success: true,
      output: {
        results: (data.results ?? []).map((result: any) => ({
          entity_id: result.entity_id ?? result.id ?? '',
          source_name: result.source_name ?? '',
          md_content: result.md_content ?? null,
          score: result.score ?? 0,
          metadata: result.metadata ?? null,
          breadcrumbs: result.breadcrumbs ?? null,
          url: result.url ?? null,
        })),
        ...(data.completion && { completion: data.completion }),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Search results with content, scores, and metadata from your synced data',
      items: {
        type: 'object',
        properties: AIRWEAVE_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
    completion: {
      type: 'string',
      description: 'AI-generated answer to the query (when generateAnswer is enabled)',
      optional: true,
    },
  },
}
