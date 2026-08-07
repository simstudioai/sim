import type { EmbeddingAdapterFactory } from '@/lib/embeddings/types'

interface MistralEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

/**
 * Mistral `/v1/embeddings`. The REST body field is `input` (singular), even
 * though Mistral's SDK examples show `inputs`. Mistral has no task
 * conditioning, so `taskType` is ignored.
 */
export const createMistralAdapter: EmbeddingAdapterFactory = ({ modelName, apiKey }) => ({
  buildRequest: ({ inputs, dimensions }) => ({
    apiUrl: 'https://api.mistral.ai/v1/embeddings',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: modelName,
      input: inputs,
      encoding_format: 'float',
      ...(dimensions !== undefined && { output_dimension: dimensions }),
    },
    parse: (json) => {
      const { data } = json as MistralEmbeddingResponse
      /** Mistral returns an `index` per item; sort so vectors match input order. */
      return [...data].sort((a, b) => a.index - b.index).map((item) => item.embedding)
    },
    parseTokens: (json) => (json as MistralEmbeddingResponse).usage?.total_tokens,
  }),
})
