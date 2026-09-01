import { DEFAULT_OPENROUTER_EMBEDDING_MODEL } from '@/lib/embeddings/openrouter-models'
import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsOpenRouterTool = createEmbeddingTool({
  id: 'embeddings_openrouter',
  name: 'OpenRouter Embeddings',
  provider: 'openrouter',
  description: 'Generate embeddings through OpenRouter',
  defaultModel: DEFAULT_OPENROUTER_EMBEDDING_MODEL,
})
