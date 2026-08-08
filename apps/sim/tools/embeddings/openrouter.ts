import { createEmbeddingTool } from '@/tools/embeddings/factory'
import type { EmbeddingsParams, EmbeddingsResponse } from '@/tools/embeddings/types'
import type { ToolConfig } from '@/tools/types'

const OPENROUTER_TOOL_ID = 'embeddings_openrouter'

const openRouterTool = createEmbeddingTool({
  id: OPENROUTER_TOOL_ID,
  name: 'OpenRouter Embeddings',
  provider: 'openrouter',
  description: 'Generate embeddings from OpenAI embedding models through OpenRouter',
  envKeyPrefix: 'OPENROUTER_API_KEY',
})

export const embeddingsOpenRouterTool: ToolConfig<EmbeddingsParams, EmbeddingsResponse> = {
  ...openRouterTool,
  id: 'embeddings_openrouter',
  name: 'OpenRouter Embeddings',
  description: 'Generate embeddings from OpenAI embedding models through OpenRouter',
  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text to embed, or an array of texts to embed in one call',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Embedding model to use',
      default: 'text-embedding-3-small',
    },
    taskType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'What the embedding is for, when the model supports task conditioning: document, query, similarity, classification, or clustering',
    },
    dimensions: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Output dimensions, when the model supports truncation. Defaults to native.',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'OpenRouter API key; optional on self-hosted deployments with OPENROUTER_API_KEY configured',
    },
  },
  request: openRouterTool.request,
}
