import { l2Normalize } from '@/lib/embeddings/normalize'
import type { EmbeddingAdapterFactory, EmbeddingTaskType } from '@/lib/embeddings/types'

/** Cohere's v2 embed endpoint rejects requests with more than 96 texts. */
const COHERE_MAX_ITEMS_PER_REQUEST = 96

/**
 * Cohere has no dedicated semantic-similarity input type; `similarity` falls
 * back to `search_document`, and the catalog does not offer it for this model.
 */
const COHERE_INPUT_TYPES: Record<EmbeddingTaskType, string> = {
  document: 'search_document',
  query: 'search_query',
  similarity: 'search_document',
  classification: 'classification',
  clustering: 'clustering',
}

interface CohereEmbeddingResponse {
  embeddings: { float?: number[][] }
  meta?: { billed_units?: { input_tokens?: number } }
}

/**
 * Cohere `/v2/embed`. `input_type` is required by the API, so a task type is
 * always sent.
 *
 * Cohere documents `output_dimension` as Matryoshka truncation but never states
 * whether it renormalizes the truncated vector. Rather than depend on an
 * undocumented guarantee, reduced output is normalized locally: `l2Normalize` is
 * idempotent, so this is a no-op if Cohere already returns unit vectors and a
 * correctness fix if it does not.
 */
export const createCohereAdapter: EmbeddingAdapterFactory = ({
  modelName,
  apiKey,
  nativeDimensions,
}) => ({
  maxItemsPerRequest: COHERE_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, taskType, dimensions }) => ({
    apiUrl: 'https://api.cohere.com/v2/embed',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: modelName,
      texts: inputs,
      input_type: COHERE_INPUT_TYPES[taskType],
      embedding_types: ['float'],
      ...(dimensions !== undefined && { output_dimension: dimensions }),
    },
    parse: (json) => {
      const vectors = (json as CohereEmbeddingResponse).embeddings?.float
      if (!vectors) {
        throw new Error('Cohere embed response did not include float embeddings')
      }
      const isReduced = dimensions !== undefined && dimensions < nativeDimensions
      return isReduced ? vectors.map(l2Normalize) : vectors
    },
    parseTokens: (json) => (json as CohereEmbeddingResponse).meta?.billed_units?.input_tokens,
  }),
})
