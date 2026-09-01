import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsMistralTool = createEmbeddingTool({
  id: 'embeddings_mistral',
  name: 'Mistral Embeddings',
  provider: 'mistral',
  description: "Generate embeddings from text using Mistral's embedding models",
  envKeyPrefix: 'MISTRAL_API_KEY',
})
