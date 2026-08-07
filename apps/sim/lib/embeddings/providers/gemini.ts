import { l2Normalize } from '@/lib/embeddings/normalize'
import type { EmbeddingAdapterFactory, EmbeddingTaskType } from '@/lib/embeddings/types'

/**
 * Gemini rejects batch embedding requests above 100 items. Google does not state
 * this in the `batchEmbedContents` reference, so the cap is set from the limit
 * the API is observed to enforce rather than from a documented figure.
 */
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
  /**
   * `EmbeddingUsageMetadata` on `BatchEmbedContentsResponse`. Optional because
   * older API surfaces omit it; the caller then falls back to a local estimate.
   */
  usageMetadata?: { promptTokenCount?: number }
}

/**
 * Gemini `batchEmbedContents`. Gemini does not normalize when the output is
 * reduced below the model's native dimensionality, so vectors are normalized
 * locally in that case.
 *
 * Token counts come from the response rather than a local estimate: tiktoken has
 * no Gemini encoding and falls back to `cl100k_base`, which does not match how
 * Gemini actually tokenizes, and this count is what knowledge-base runs bill on.
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
      parseTokens: (json) => (json as GeminiEmbeddingResponse).usageMetadata?.promptTokenCount,
    }
  },
})
