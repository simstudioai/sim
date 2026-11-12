import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'
import type { VoyageAIRerankParams, VoyageAIRerankResponse } from '@/tools/voyageai/types'
import { parseDocumentTexts, requireModel, toOptionalPositiveInteger } from '@/tools/voyageai/utils'

/** USD per 1M tokens, from Voyage's pricing page. */
const RERANK_PRICE_PER_MILLION_TOKENS: Record<string, number> = {
  'rerank-3': 0.05,
  'rerank-3-lite': 0.02,
  'rerank-2.5': 0.05,
  'rerank-2.5-lite': 0.02,
}

interface VoyageRerankApiResponse {
  data?: Array<{ index: number; relevance_score: number; document?: string }>
  model?: string
  usage?: { total_tokens?: number }
}

export const voyageaiRerankTool: ToolConfig<VoyageAIRerankParams, VoyageAIRerankResponse> = {
  id: 'voyageai_rerank',
  name: 'Voyage AI Rerank',
  description:
    'Rank a list of texts by relevance to a query with a Voyage AI reranker, most relevant first',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.VOYAGE_ERRORS,

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The query to rank the documents against',
    },
    documents: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'The texts to rank, as a list of strings (up to 1,000)',
      items: { type: 'string', description: 'A document text' },
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Reranker model: rerank-3, rerank-3-lite, rerank-2.5 or rerank-2.5-lite',
    },
    topK: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of most relevant documents to return. Defaults to all of them.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Voyage AI API key',
    },
  },

  request: {
    url: 'https://api.voyageai.com/v1/rerank',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    modelInput: {
      mode: 'project',
      select: (params) => ({ query: params.query, documents: params.documents }),
    },
    body: (params) => {
      const topK = toOptionalPositiveInteger(params.topK, 'Top K')
      return {
        query: params.query,
        documents: parseDocumentTexts(params.documents),
        model: requireModel(params.model),
        return_documents: true,
        ...(topK !== undefined && { top_k: topK }),
      }
    },
  },

  hosting: {
    envKeyPrefix: 'VOYAGE_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'voyage',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const model = typeof output.model === 'string' ? output.model : params.model
        const price = model ? RERANK_PRICE_PER_MILLION_TOKENS[model] : undefined
        if (price === undefined) {
          throw new Error(`No pricing configured for Voyage AI reranker: ${String(model)}`)
        }
        const tokens = output.totalTokens
        if (typeof tokens !== 'number' || Number.isNaN(tokens)) {
          throw new Error('Voyage AI rerank response missing token usage')
        }
        return {
          cost: (tokens * price) / 1_000_000,
          metadata: { model, totalTokens: tokens, inputPricePerMillion: price },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
      burstMultiplier: 1,
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as VoyageRerankApiResponse
    return {
      success: true,
      output: {
        results: (data.data ?? []).map((item) => ({
          index: item.index,
          relevanceScore: item.relevance_score,
          document: item.document ?? '',
        })),
        model: data.model ?? '',
        totalTokens: data.usage?.total_tokens,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Documents ranked by relevance, most relevant first',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Position of the document in the input list' },
          relevanceScore: { type: 'number', description: 'Relevance of the document to the query' },
          document: { type: 'string', description: 'The document text' },
        },
      },
    },
    model: { type: 'string', description: 'Reranker model used' },
    totalTokens: {
      type: 'number',
      description: 'Tokens billed for the request',
      optional: true,
    },
  },
}
