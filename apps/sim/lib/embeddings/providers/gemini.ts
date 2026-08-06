import { l2Normalize } from '@/lib/embeddings/normalize'
import type { EmbeddingAdapterFactory, EmbeddingTaskType } from '@/lib/embeddings/types'

/** Gemini's `batchEmbedContents` rejects requests with more than 100 items. */
const GEMINI_MAX_ITEMS_PER_REQUEST = 100

const GEMINI_TASK_TYPES: Record<EmbeddingTaskType, string> = {
  document: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
  similarity: 'SEMANTIC_SIMILARITY',
  classification: 'CLASSIFICATION',
  clustering: 'CLUSTERING',
}

interface GeminiEmbeddingResponse {
  embeddings: Array<{ values: number[] }>
}

/**
 * Gemini `batchEmbedContents`. Gemini does not normalize when the output is
 * reduced below the model's native dimensionality, so vectors are normalized
 * locally in that case.
 */
export const createGeminiAdapter: EmbeddingAdapterFactory = ({
  modelName,
  apiKey,
  nativeDimensions,
}) => ({
  maxItemsPerRequest: GEMINI_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, taskType, dimensions }) => {
    const isReduced = dimensions !== undefined && dimensions < nativeDimensions
    return {
      apiUrl: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:batchEmbedContents`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: {
        requests: inputs.map((text) => ({
          model: `models/${modelName}`,
          content: { parts: [{ text }] },
          taskType: GEMINI_TASK_TYPES[taskType],
          ...(dimensions !== undefined && { outputDimensionality: dimensions }),
        })),
      },
      parse: (json) => {
        const values = (json as GeminiEmbeddingResponse).embeddings.map((item) => item.values)
        return isReduced ? values.map(l2Normalize) : values
      },
    }
  },
})
