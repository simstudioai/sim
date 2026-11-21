import type { EmbeddingAdapterFactory, EmbeddingTaskType } from '@/lib/embeddings/types'

/** Voyage rejects a request with more than 1,000 inputs. */
const VOYAGE_MAX_ITEMS_PER_REQUEST = 1000

/**
 * Voyage conditions on two input types only. The catalog offers nothing else for
 * its models, so the remaining task types send no `input_type`, which Voyage
 * documents as a valid unconditioned embedding that stays compatible with typed ones.
 */
const VOYAGE_INPUT_TYPES: Partial<Record<EmbeddingTaskType, string>> = {
  document: 'document',
  query: 'query',
}

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  usage?: { total_tokens?: number }
}

/**
 * Voyage `/v1/embeddings`. `output_dimension` is Matryoshka reduction and is only
 * sent when the caller asked for one; Voyage rejects it for models with a single
 * fixed width.
 */
export const createVoyageAdapter: EmbeddingAdapterFactory = ({ modelName, apiKey }) => ({
  maxItemsPerRequest: VOYAGE_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, taskType, dimensions }) => {
    const inputType = VOYAGE_INPUT_TYPES[taskType]
    return {
      apiUrl: 'https://api.voyageai.com/v1/embeddings',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: modelName,
        input: inputs,
        ...(inputType !== undefined && { input_type: inputType }),
        ...(dimensions !== undefined && { output_dimension: dimensions }),
      },
      parse: (json) => {
        const { data } = json as VoyageEmbeddingResponse
        /** Voyage returns an `index` per item; sort so vectors match input order. */
        return [...data].sort((a, b) => a.index - b.index).map((item) => item.embedding)
      },
      parseTokens: (json) => (json as VoyageEmbeddingResponse).usage?.total_tokens,
    }
  },
})
