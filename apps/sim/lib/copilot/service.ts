import { sql } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'

const logger = createLogger('CopilotService')

/**
 * Documentation search result
 */
export interface DocumentationSearchResult {
  id: number
  title: string
  url: string
  content: string
  similarity: number
}

/**
 * Options for documentation search
 */
export interface SearchDocumentationOptions {
  topK?: number
  threshold?: number
}

/**
 * Search documentation using RAG
 */
export async function searchDocumentation(
  query: string,
  options: SearchDocumentationOptions = {}
): Promise<DocumentationSearchResult[]> {
  const { topK = 10, threshold = 0.7 } = options

  try {
    // Generate embedding for the query
    const { generateEmbeddings } = await import('@/app/api/knowledge/utils')
    const embeddings = await generateEmbeddings([query])
    const queryEmbedding = embeddings[0]

    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger.warn('Failed to generate query embedding')
      return []
    }

    // Search docs embeddings using vector similarity
    const results = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
      .from(docsEmbeddings)
      .orderBy(sql`${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(topK)

    // Filter by similarity threshold
    const filteredResults = results.filter((result) => result.similarity >= threshold)

    return filteredResults.map((result, index) => ({
      id: index + 1,
      title: String(result.headerText || 'Untitled Section'),
      url: String(result.sourceLink || '#'),
      content: String(result.chunkText || ''),
      similarity: result.similarity,
    }))
  } catch (error) {
    logger.error('Failed to search documentation:', error)
    return []
  }
}
