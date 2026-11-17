import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsPerplexityTool = createEmbeddingTool({
  id: 'embeddings_perplexity',
  name: 'Perplexity Embeddings',
  provider: 'perplexity',
  description: "Generate embeddings from text using Perplexity's embedding models",
  envKeyPrefix: 'PERPLEXITY_API_KEY',
})
