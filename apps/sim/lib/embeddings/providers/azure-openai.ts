import {
  OPENAI_MAX_ITEMS_PER_REQUEST,
  type OpenAIEmbeddingResponse,
} from '@/lib/embeddings/providers/openai'
import type { AzureEmbeddingAdapterContext, EmbeddingAdapterFactory } from '@/lib/embeddings/types'

/**
 * Azure OpenAI embeddings. The model is selected by the deployment name in the
 * URL rather than a `model` body field, so `modelName` here is the deployment.
 */
export const createAzureOpenAIAdapter: EmbeddingAdapterFactory<AzureEmbeddingAdapterContext> = ({
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
    parse: (json) => (json as OpenAIEmbeddingResponse).data.map((item) => item.embedding),
    parseTokens: (json) => (json as OpenAIEmbeddingResponse).usage?.total_tokens,
  }),
})
