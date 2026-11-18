import { l2Normalize } from '@/lib/embeddings/normalize'
import type { EmbeddingAdapterFactory } from '@/lib/embeddings/types'

/** Perplexity's embeddings endpoint accepts at most 512 inputs per request. */
const PERPLEXITY_MAX_ITEMS_PER_REQUEST = 512

interface PerplexityEmbeddingResponse {
  data: Array<{ embedding: string; index: number }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

/**
 * Perplexity `/v1/embeddings`. The API has no float encoding: `base64_int8`
 * returns each vector as base64-encoded signed int8 values, so they are decoded
 * here and L2-normalized to match the unit vectors other providers return.
 * Normalizing keeps cosine similarity unchanged and makes inner product match
 * it. Perplexity has no task conditioning for these models, so `taskType` is
 * ignored.
 */
export const createPerplexityAdapter: EmbeddingAdapterFactory = ({ modelName, apiKey }) => ({
  maxItemsPerRequest: PERPLEXITY_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, dimensions }) => ({
    apiUrl: 'https://api.perplexity.ai/v1/embeddings',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Sim/1.0 (+https://sim.ai)',
      'X-Pplx-Integration': 'sim',
    },
    body: {
      model: modelName,
      input: inputs,
      encoding_format: 'base64_int8',
      ...(dimensions !== undefined && { dimensions }),
    },
    parse: (json) => {
      const { data } = json as PerplexityEmbeddingResponse
      return [...data]
        .sort((a, b) => a.index - b.index)
        .map((item) =>
          l2Normalize(Array.from(new Int8Array(Buffer.from(item.embedding, 'base64'))))
        )
    },
    parseTokens: (json) => (json as PerplexityEmbeddingResponse).usage?.total_tokens,
  }),
})
