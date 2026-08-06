import { OPENAI_MAX_ITEMS_PER_REQUEST } from '@/lib/embeddings/providers/openai'
import type { EmbeddingAdapterFactory } from '@/lib/embeddings/types'

interface AzureOpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>
  usage?: { prompt_tokens?: number; total_tokens?: number }
}

/**
 * Azure OpenAI embeddings. The model is selected by the deployment name in the
 * URL rather than a `model` body field, so `modelName` here is the deployment.
 */
export const createAzureOpenAIAdapter: EmbeddingAdapterFactory = ({
  modelName,
  apiKey,
  endpoint,
  apiVersion,
}) => ({
  maxItemsPerRequest: OPENAI_MAX_ITEMS_PER_REQUEST,
  buildRequest: ({ inputs, dimensions }) => ({
    apiUrl: `${endpoint}/openai/deployments/${modelName}/embeddings?api-version=${apiVersion}`,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: {
      input: inputs,
      encoding_format: 'float',
      ...(dimensions !== undefined && { dimensions }),
    },
    parse: (json) => (json as AzureOpenAIEmbeddingResponse).data.map((item) => item.embedding),
    parseTokens: (json) => (json as AzureOpenAIEmbeddingResponse).usage?.total_tokens,
  }),
})
