import type { EmbeddingAdapterFactory } from '@/lib/embeddings/types'

/** Shared by the OpenAI and Azure OpenAI adapters — Azure mirrors this wire shape exactly. */
export interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

/** OpenAI rejects an `input` array longer than 2048 entries. */
export const OPENAI_MAX_ITEMS_PER_REQUEST = 2048

/**
 * OpenAI `/v1/embeddings`. Omitting `dimensions` yields the model's native
 * dimensionality, which is what callers who do not reduce should get.
 */
export const createOpenAIAdapter: EmbeddingAdapterFactory = ({ modelName, apiKey }) => ({
  maxItemsPerRequest: OPENAI_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, dimensions }) => ({
    apiUrl: 'https://api.openai.com/v1/embeddings',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      input: inputs,
      model: modelName,
      encoding_format: 'float',
      ...(dimensions !== undefined && { dimensions }),
    },
    parse: (json) => (json as OpenAIEmbeddingResponse).data.map((item) => item.embedding),
    parseTokens: (json) => (json as OpenAIEmbeddingResponse).usage?.total_tokens,
  }),
})
