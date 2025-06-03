import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { retryWithExponentialBackoff } from '@/lib/documents/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { embedding, knowledgeBase } from '@/db/schema'

const logger = createLogger('VectorSearchAPI')

class APIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

// Schema for vector search request
const VectorSearchSchema = z.object({
  knowledgeBaseId: z.string().min(1, 'Knowledge base ID is required'),
  query: z.string().min(1, 'Search query is required'),
  topK: z.number().min(1).max(100).default(10),
})

async function generateSearchEmbedding(query: string): Promise<number[]> {
  const openaiApiKey = env.OPENAI_API_KEY
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  try {
    return await retryWithExponentialBackoff(
      async () => {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: query,
            model: 'text-embedding-3-small',
            encoding_format: 'float',
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          const error = new APIError(
            `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`,
            response.status
          )
          throw error
        }

        const data = await response.json()

        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
          throw new Error('Invalid response format from OpenAI embeddings API')
        }

        return data.data[0].embedding
      },
      {
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 30000, // Max 30 seconds delay for search queries
        backoffMultiplier: 2,
      }
    )
  } catch (error) {
    logger.error('Failed to generate search embedding:', error)
    throw new Error(
      `Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing vector search request`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized vector search attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    try {
      const validatedData = VectorSearchSchema.parse(body)

      // Verify the knowledge base exists and user has access
      const kb = await db
        .select()
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.id, validatedData.knowledgeBaseId),
            eq(knowledgeBase.userId, session.user.id),
            isNull(knowledgeBase.deletedAt)
          )
        )
        .limit(1)

      if (kb.length === 0) {
        logger.warn(
          `[${requestId}] Knowledge base not found or access denied: ${validatedData.knowledgeBaseId}`
        )
        return NextResponse.json(
          { error: 'Knowledge base not found or access denied' },
          { status: 404 }
        )
      }

      // Generate embedding for the search query
      logger.info(`[${requestId}] Generating embedding for search query`)
      const queryEmbedding = await generateSearchEmbedding(validatedData.query)

      // Perform vector similarity search using pgvector cosine similarity
      logger.info(`[${requestId}] Performing vector search with topK=${validatedData.topK}`)

      const results = await db
        .select({
          id: embedding.id,
          content: embedding.content,
          documentId: embedding.documentId,
          chunkIndex: embedding.chunkIndex,
          metadata: embedding.metadata,
          similarity: sql<number>`1 - (${embedding.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
        })
        .from(embedding)
        .where(
          and(
            eq(embedding.knowledgeBaseId, validatedData.knowledgeBaseId),
            eq(embedding.enabled, true)
          )
        )
        .orderBy(sql`${embedding.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
        .limit(validatedData.topK)

      logger.info(`[${requestId}] Vector search completed. Found ${results.length} results`)

      return NextResponse.json({
        success: true,
        data: {
          results: results.map((result) => ({
            id: result.id,
            content: result.content,
            documentId: result.documentId,
            chunkIndex: result.chunkIndex,
            metadata: result.metadata,
            similarity: result.similarity,
          })),
          query: validatedData.query,
          knowledgeBaseId: validatedData.knowledgeBaseId,
          topK: validatedData.topK,
          totalResults: results.length,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid vector search data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error performing vector search`, error)
    return NextResponse.json(
      {
        error: 'Failed to perform vector search',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
