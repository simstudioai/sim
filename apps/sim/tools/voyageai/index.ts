import { embeddingsTool } from '@/tools/voyageai/embeddings'
import { multimodalEmbeddingsTool } from '@/tools/voyageai/multimodal-embeddings'
import { rerankTool } from '@/tools/voyageai/rerank'

export const voyageaiEmbeddingsTool = embeddingsTool
export const voyageaiMultimodalEmbeddingsTool = multimodalEmbeddingsTool
export const voyageaiRerankTool = rerankTool

export * from './types'
