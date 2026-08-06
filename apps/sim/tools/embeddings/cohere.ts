import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsCohereTool = createEmbeddingTool({
  id: 'embeddings_cohere',
  name: 'Cohere Embeddings',
  provider: 'cohere',
  description: "Generate embeddings from text using Cohere's embedding models",
  envKeyPrefix: 'COHERE_API_KEY',
})
