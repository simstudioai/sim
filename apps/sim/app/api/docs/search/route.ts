import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'

const logger = createLogger('DocsSearchAPI')

// Request and response type definitions
interface DocsSearchRequest {
  query: string
  topK?: number
}

interface DocsSearchResult {
  id: number
  title: string
  url: string
  content: string
  similarity: number
}

interface DocsSearchSuccessResponse {
  success: true
  results: DocsSearchResult[]
  query: string
  totalResults: number
  searchTime?: number
}

interface DocsSearchErrorResponse {
  success: false
  error: string
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<DocsSearchSuccessResponse | DocsSearchErrorResponse>> {
  try {
    const requestBody: DocsSearchRequest = await request.json()
    const { query, topK = 10 } = requestBody

    if (!query) {
      const errorResponse: DocsSearchErrorResponse = {
        success: false,
        error: 'Query is required',
      }
      return NextResponse.json(errorResponse, { status: 400 })
    }

    logger.info('Executing documentation search', { query, topK })

    const startTime = Date.now()
    
    // Search documentation using RAG - inlined from copilot service
    let results: DocsSearchResult[] = []
    try {
      const threshold = 0.7
      
      // Generate embedding for the query
      const { generateEmbeddings } = await import('@/app/api/knowledge/utils')
      const embeddings = await generateEmbeddings([query])
      const queryEmbedding = embeddings[0]

      if (!queryEmbedding || queryEmbedding.length === 0) {
        logger.warn('Failed to generate query embedding')
        results = []
      } else {
        // Search docs embeddings using vector similarity
        const dbResults = await db
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
        const filteredResults = dbResults.filter((result) => result.similarity >= threshold)

        results = filteredResults.map((result, index) => ({
          id: index + 1,
          title: String(result.headerText || 'Untitled Section'),
          url: String(result.sourceLink || '#'),
          content: String(result.chunkText || ''),
          similarity: result.similarity,
        }))
      }
    } catch (error) {
      logger.error('Failed to search documentation:', error)
      results = []
    }
    
    const searchTime = Date.now() - startTime
    logger.info(`Found ${results.length} documentation results`, { query })

    const successResponse: DocsSearchSuccessResponse = {
      success: true,
      results,
      query,
      totalResults: results.length,
      searchTime,
    }

    return NextResponse.json(successResponse)
  } catch (error) {
    logger.error('Documentation search API failed', error)

    const errorResponse: DocsSearchErrorResponse = {
      success: false,
      error: `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }

    return NextResponse.json(errorResponse, { status: 500 })
  }
}
