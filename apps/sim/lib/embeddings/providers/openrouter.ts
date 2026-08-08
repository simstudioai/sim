import { toOpenRouterWireEmbeddingModelId } from '@/lib/embeddings/openrouter-models'
import {
  OPENAI_MAX_ITEMS_PER_REQUEST,
  type OpenAIEmbeddingResponse,
} from '@/lib/embeddings/providers/openai'
import type { EmbeddingAdapterFactory } from '@/lib/embeddings/types'

/** OpenRouter exposes embedding models under provider-qualified model ids. */
export const createOpenRouterAdapter: EmbeddingAdapterFactory = ({ modelName, apiKey }) => ({
  maxItemsPerRequest: OPENAI_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, dimensions }) => ({
    apiUrl: 'https://openrouter.ai/api/v1/embeddings',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      input: inputs,
      model: toOpenRouterWireEmbeddingModelId(modelName),
      encoding_format: 'float',
      ...(dimensions !== undefined && { dimensions }),
    },
    parse: (json) => (json as OpenAIEmbeddingResponse).data.map((item) => item.embedding),
    parseTokens: (json) => (json as OpenAIEmbeddingResponse).usage?.total_tokens,
  }),
})
