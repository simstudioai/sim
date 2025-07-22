import { fetchTool } from '@/tools/pinecone/fetch'
import { generateEmbeddingsTool } from '@/tools/pinecone/generate_embeddings'
import { searchTextTool } from '@/tools/pinecone/search_text'
import { searchVectorTool } from '@/tools/pinecone/search_vector'
import { upsertTextTool } from '@/tools/pinecone/upsert_text'

export const pineconeFetchTool = fetchTool
export const pineconeGenerateEmbeddingsTool = generateEmbeddingsTool
export const pineconeSearchTextTool = searchTextTool
export const pineconeSearchVectorTool = searchVectorTool
export const pineconeUpsertTextTool = upsertTextTool
