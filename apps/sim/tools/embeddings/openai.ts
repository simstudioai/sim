import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsOpenAITool = createEmbeddingTool({
  id: 'embeddings_openai',
  name: 'OpenAI Embeddings',
  provider: 'openai',
  description: "Generate embeddings from text using OpenAI's embedding models",
  envKeyPrefix: 'OPENAI_API_KEY',
})
