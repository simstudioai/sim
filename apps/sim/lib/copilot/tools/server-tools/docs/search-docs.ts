import { sql } from 'drizzle-orm'
import { getCopilotConfig } from '@/lib/copilot/config'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'
import { BaseCopilotTool } from '../base'

interface DocsSearchParams {
  query: string
  topK?: number
  threshold?: number
}

interface DocumentationSearchResult {
  id: number
  title: string
  url: string
  content: string
  similarity: number
}

interface DocsSearchResult {
  results: DocumentationSearchResult[]
  query: string
  totalResults: number
}

class SearchDocsTool extends BaseCopilotTool<DocsSearchParams, DocsSearchResult> {
  readonly id = 'search_documentation'
  readonly displayName = 'Searching documentation'

  protected async executeImpl(params: DocsSearchParams): Promise<DocsSearchResult> {
    return searchDocs(params)
  }
}

// Export the tool instance
export const searchDocsTool = new SearchDocsTool()

// Implementation function
async function searchDocs(params: DocsSearchParams): Promise<DocsSearchResult> {
  const logger = createLogger('DocsSearch')
  const { query, topK = 10, threshold } = params

  logger.info('Executing docs search for copilot', {
    query,
    topK,
  })

  try {
    const config = getCopilotConfig()
    const similarityThreshold = threshold ?? config.rag.similarityThreshold

    // Generate embedding for the query
    const { generateEmbeddings } = await import('@/app/api/knowledge/utils')

    logger.info('About to generate embeddings for query', { query, queryLength: query.length })

    const embeddings = await generateEmbeddings([query])
    const queryEmbedding = embeddings[0]

    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger.warn('Failed to generate query embedding')
      return {
        results: [],
        query,
        totalResults: 0,
      }
    }

    logger.info('Successfully generated query embedding', {
      embeddingLength: queryEmbedding.length,
    })

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
    const filteredResults = results.filter((result) => result.similarity >= similarityThreshold)

    const documentationResults: DocumentationSearchResult[] = filteredResults.map(
      (result, index) => ({
        id: index + 1,
        title: String(result.headerText || 'Untitled Section'),
        url: String(result.sourceLink || '#'),
        content: String(result.chunkText || ''),
        similarity: result.similarity,
      })
    )

    logger.info(`Found ${documentationResults.length} documentation results`, { query })

    return {
      results: documentationResults,
      query,
      totalResults: documentationResults.length,
    }
  } catch (error) {
    logger.error('Documentation search failed with detailed error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      query,
      errorType: error?.constructor?.name,
      status: (error as any)?.status,
    })
    throw new Error(
      `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
