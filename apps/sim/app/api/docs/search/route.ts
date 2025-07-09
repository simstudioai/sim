import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { generateEmbeddings } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'

const logger = createLogger('DocsSearch')

const DocsSearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  topK: z.number().min(1).max(10).default(5),
})

/**
 * Generate embedding for search query
 */
async function generateSearchEmbedding(query: string): Promise<number[]> {
  try {
    const embeddings = await generateEmbeddings([query])
    return embeddings[0] || []
  } catch (error) {
    logger.error('Failed to generate search embedding:', error)
    throw new Error('Failed to generate search embedding')
  }
}

/**
 * Search docs embeddings using vector similarity
 */
async function searchDocs(queryEmbedding: number[], topK: number) {
  try {
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

    return results
  } catch (error) {
    logger.error('Failed to search docs:', error)
    throw new Error('Failed to search docs')
  }
}

/**
 * POST /api/docs/search
 * Search Sim Studio documentation using vector similarity
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const body = await req.json()
    const { query, topK } = DocsSearchSchema.parse(body)

    logger.info(`[${requestId}] 🔍 DOCS SEARCH TOOL CALLED - Query: "${query}"`, { topK })

    // Step 1: Generate embedding for the query
    logger.info(`[${requestId}] Generating query embedding...`)
    const queryEmbedding = await generateSearchEmbedding(query)

    if (queryEmbedding.length === 0) {
      return NextResponse.json({ error: 'Failed to generate query embedding' }, { status: 500 })
    }

    // Step 2: Search for relevant docs chunks
    logger.info(`[${requestId}] Searching docs for top ${topK} chunks...`)
    const chunks = await searchDocs(queryEmbedding, topK)

    if (chunks.length === 0) {
      return NextResponse.json({
        success: true,
        response: "I couldn't find any relevant documentation for that query.",
        sources: [],
        metadata: {
          requestId,
          chunksFound: 0,
          query,
        },
      })
    }

    // Step 3: Format the response with context and sources
    const context = chunks
      .map((chunk, index) => {
        const headerText = typeof chunk.headerText === 'string' ? chunk.headerText : String(chunk.headerText || 'Untitled Section')
        const sourceDocument = typeof chunk.sourceDocument === 'string' ? chunk.sourceDocument : String(chunk.sourceDocument || 'Unknown Document')
        const sourceLink = typeof chunk.sourceLink === 'string' ? chunk.sourceLink : String(chunk.sourceLink || '#')
        const chunkText = typeof chunk.chunkText === 'string' ? chunk.chunkText : String(chunk.chunkText || '')

        return `[${index + 1}] ${headerText}
Document: ${sourceDocument}
URL: ${sourceLink}
Content: ${chunkText}`
      })
      .join('\n\n')

    // Step 4: Format sources for response
    const sources = chunks.map((chunk, index) => ({
      id: index + 1,
      title: chunk.headerText,
      document: chunk.sourceDocument,
      link: chunk.sourceLink,
      similarity: Math.round(chunk.similarity * 100) / 100,
    }))

    logger.info(`[${requestId}] Found ${chunks.length} relevant chunks`)

    return NextResponse.json({
      success: true,
      response: context,
      sources,
      metadata: {
        requestId,
        chunksFound: chunks.length,
        query,
        topSimilarity: sources[0]?.similarity,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Docs search error:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 