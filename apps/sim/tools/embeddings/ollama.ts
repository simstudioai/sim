import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsOllamaTool = createEmbeddingTool({
  id: 'embeddings_ollama',
  name: 'Ollama Embeddings',
  provider: 'ollama',
  description: 'Generate embeddings on a self-hosted Ollama server',
})
