import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'
import type {
  VoyageAIContextualizedEmbeddingsParams,
  VoyageAIContextualizedEmbeddingsResponse,
} from '@/tools/voyageai/types'
import {
  parseContextualizedInputs,
  requireInputType,
  requireModel,
  toOptionalPositiveInteger,
} from '@/tools/voyageai/utils'

/** Largest chunk the contextualized models take (their 32,000-token window). */
const AUTO_CHUNK_SIZE = 32_000

/** USD per 1M tokens, from Voyage's pricing page. */
const CONTEXTUALIZED_PRICE_PER_MILLION_TOKENS: Record<string, number> = {
  'voyage-context-4': 0.12,
  'voyage-context-3': 0.18,
}

interface VoyageContextualizedApiResponse {
  data?: Array<{
    index: number
    data?: Array<{ index: number; embedding: number[]; text?: string }>
  }>
  model?: string
  usage?: { total_tokens?: number }
}

export const voyageaiContextualizedEmbeddingsTool: ToolConfig<
  VoyageAIContextualizedEmbeddingsParams,
  VoyageAIContextualizedEmbeddingsResponse
> = {
  id: 'voyageai_contextualized_embeddings',
  name: 'Voyage AI Contextualized Embeddings',
  description:
    'Embed documents with a contextualized model: Voyage splits each document into chunks, and every chunk vector also reflects the whole document it came from',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.VOYAGE_ERRORS,

  params: {
    input: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Texts to embed, as a list of strings. For document: the full text of each document, which Voyage chunks itself. For query: one search query per entry.',
      items: { type: 'string', description: 'The full text of a document, or a search query' },
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Embedding model: voyage-context-4 or voyage-context-3',
    },
    inputType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'What the embeddings are for: document (documents to index, chunked by Voyage) or query (search queries)',
    },
    dimensions: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Output dimensions: 256, 512, 1024 (default), or 2048',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Voyage AI API key',
    },
  },

  request: {
    url: 'https://api.voyageai.com/v1/contextualizedembeddings',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    modelInput: {
      mode: 'project',
      select: (params) => ({ input: params.input }),
    },
    body: (params) => {
      const inputType = requireInputType(params.inputType)
      const dimensions = toOptionalPositiveInteger(params.dimensions, 'Dimensions')
      return {
        inputs: parseContextualizedInputs(params.input, inputType),
        model: requireModel(params.model),
        input_type: inputType,
        /** Voyage allows auto-chunking for documents only, and rejects it for queries. */
        ...(inputType === 'document' && {
          enable_auto_chunking: true,
          chunk_size: AUTO_CHUNK_SIZE,
        }),
        ...(dimensions !== undefined && { output_dimension: dimensions }),
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
        const price = model ? CONTEXTUALIZED_PRICE_PER_MILLION_TOKENS[model] : undefined
        if (price === undefined) {
          throw new Error(`No pricing configured for Voyage AI embedding model: ${String(model)}`)
        }
        const tokens = output.totalTokens
        if (typeof tokens !== 'number' || Number.isNaN(tokens)) {
          throw new Error('Voyage AI embeddings response missing token usage')
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
    const data = (await response.json()) as VoyageContextualizedApiResponse
    const documents = [...(data.data ?? [])]
      .sort((a, b) => a.index - b.index)
      .map((document) => [...(document.data ?? [])].sort((a, b) => a.index - b.index))
    const embeddings = documents.map((document) => document.map((chunk) => chunk.embedding))
    /** Voyage returns the chunk text only for the chunks it cut itself (documents). */
    const hasChunkText = documents.some((document) => document.some((chunk) => chunk.text))
    return {
      success: true,
      output: {
        embeddings,
        ...(hasChunkText && {
          chunks: documents.map((document) => document.map((chunk) => chunk.text ?? '')),
        }),
        model: data.model ?? '',
        dimensions: embeddings[0]?.[0]?.length ?? 0,
        totalTokens: data.usage?.total_tokens,
      },
    }
  },

  outputs: {
    embeddings: {
      type: 'json',
      description:
        'Embedding vectors grouped by document: one list per input document, one vector per chunk, in input order',
    },
    chunks: {
      type: 'json',
      description:
        'The text of each chunk, grouped like embeddings. Returned for documents, which Voyage chunks itself',
      optional: true,
    },
    model: { type: 'string', description: 'Model used' },
    dimensions: { type: 'number', description: 'Dimensionality of each vector' },
    totalTokens: {
      type: 'number',
      description: 'Tokens billed for the request',
      optional: true,
    },
  },
}
