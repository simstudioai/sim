import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsVoyageTool = createEmbeddingTool({
  id: 'embeddings_voyage',
  name: 'Voyage AI Embeddings',
  provider: 'voyage',
  description: "Generate embeddings from text using Voyage AI's embedding models",
  envKeyPrefix: 'VOYAGE_API_KEY',
})
