import { createEmbeddingTool } from '@/tools/embeddings/factory'

export const embeddingsGeminiTool = createEmbeddingTool({
  id: 'embeddings_gemini',
  name: 'Gemini Embeddings',
  provider: 'gemini',
  description: "Generate embeddings from text using Google's Gemini embedding models",
  envKeyPrefix: 'GEMINI_API_KEY',
})
