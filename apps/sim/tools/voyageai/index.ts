import { embeddingsTool } from '@/tools/voyageai/embeddings'
import { rerankTool } from '@/tools/voyageai/rerank'

export const voyageaiEmbeddingsTool = embeddingsTool
export const voyageaiRerankTool = rerankTool

export * from './types'
