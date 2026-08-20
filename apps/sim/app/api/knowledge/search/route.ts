import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { retryWithExponentialBackoff } from '@/lib/documents/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { getUserId } from '@/app/api/auth/oauth/utils'
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

const VectorSearchSchema = z.object({
  knowledgeBaseIds: z.union([
    z.string().min(1, 'Knowledge base ID is required'),
    z.array(z.string().min(1)).min(1, 'At least one knowledge base ID is required'),
  ]),
  query: z.string().min(1, 'Search query is required'),
  topK: z.number().min(1).max(100).default(10),
})

async function generateSearchEmbedding(query: string): Promise<number[]> {
  const openaiApiKey = env.OPENAI_API_KEY
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  try {
    const embedding = await retryWithExponentialBackoff(
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
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      }
    )

    return embedding
  } catch (error) {
    logger.error('Failed to generate search embedding:', error)
    throw new Error(
      `Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

function getQueryStrategy(kbCount: number, topK: number) {
  const useParallel = kbCount > 4 || (kbCount > 2 && topK > 50)
  const distanceThreshold = kbCount > 3 ? 0.8 : 1.0
  const parallelLimit = Math.ceil(topK / kbCount) + 5

  return {
    useParallel,
    distanceThreshold,
    parallelLimit,
    singleQueryOptimized: kbCount <= 2,
  }
}

async function executeParallelQueries(
  knowledgeBaseIds: string[],
  queryVector: string,
  topK: number,
  distanceThreshold: number
) {
  const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5

  const queryPromises = knowledgeBaseIds.map(async (kbId) => {
    const results = await db
      .select({
        id: embedding.id,
        content: embedding.content,
        documentId: embedding.documentId,
        chunkIndex: embedding.chunkIndex,
        metadata: embedding.metadata,
        distance: sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance'),
        knowledgeBaseId: embedding.knowledgeBaseId,
      })
      .from(embedding)
      .where(
        and(
          eq(embedding.knowledgeBaseId, kbId),
          eq(embedding.enabled, true),
          sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`
        )
      )
      .orderBy(sql`${embedding.embedding} <=> ${queryVector}::vector`)
      .limit(parallelLimit)

    return results
  })

  const parallelResults = await Promise.all(queryPromises)
  return parallelResults.flat()
}

async function executeSingleQuery(
  knowledgeBaseIds: string[],
  queryVector: string,
  topK: number,
  distanceThreshold: number
) {
  return await db
    .select({
      id: embedding.id,
      content: embedding.content,
      documentId: embedding.documentId,
      chunkIndex: embedding.chunkIndex,
      metadata: embedding.metadata,
      distance: sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance'),
    })
    .from(embedding)
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        eq(embedding.enabled, true),
        sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`
      )
    )
    .orderBy(sql`${embedding.embedding} <=> ${queryVector}::vector`)
    .limit(topK)
}

function mergeAndRankResults(results: any[], topK: number) {
  return results.sort((a, b) => a.distance - b.distance).slice(0, topK)
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { workflowId, ...searchParams } = body

    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      const errorMessage = workflowId ? 'Workflow not found' : 'Unauthorized'
      const statusCode = workflowId ? 404 : 401
      return NextResponse.json({ error: errorMessage }, { status: statusCode })
    }

    try {
      const validatedData = VectorSearchSchema.parse(searchParams)

      const knowledgeBaseIds = Array.isArray(validatedData.knowledgeBaseIds)
        ? validatedData.knowledgeBaseIds
        : [validatedData.knowledgeBaseIds]

      const [kb, queryEmbedding] = await Promise.all([
        db
          .select()
          .from(knowledgeBase)
          .where(
            and(
              inArray(knowledgeBase.id, knowledgeBaseIds),
              eq(knowledgeBase.userId, userId),
              isNull(knowledgeBase.deletedAt)
            )
          ),
        generateSearchEmbedding(validatedData.query),
      ])

      if (kb.length === 0) {
        return NextResponse.json(
          { error: 'Knowledge base not found or access denied' },
          { status: 404 }
        )
      }

      const foundKbIds = kb.map((k) => k.id)
      const missingKbIds = knowledgeBaseIds.filter((id) => !foundKbIds.includes(id))

      if (missingKbIds.length > 0) {
        return NextResponse.json(
          { error: `Knowledge bases not found: ${missingKbIds.join(', ')}` },
          { status: 404 }
        )
      }

      // Adaptive query strategy based on KB count and parameters
      const strategy = getQueryStrategy(foundKbIds.length, validatedData.topK)
      const queryVector = JSON.stringify(queryEmbedding)

      let results: any[]

      if (strategy.useParallel) {
        // Execute parallel queries for better performance with many KBs
        const parallelResults = await executeParallelQueries(
          foundKbIds,
          queryVector,
          validatedData.topK,
          strategy.distanceThreshold
        )
        results = mergeAndRankResults(parallelResults, validatedData.topK)
      } else {
        // Execute single optimized query for fewer KBs
        results = await executeSingleQuery(
          foundKbIds,
          queryVector,
          validatedData.topK,
          strategy.distanceThreshold
        )
      }

      return NextResponse.json({
        success: true,
        data: {
          results: results.map((result) => ({
            id: result.id,
            content: result.content,
            documentId: result.documentId,
            chunkIndex: result.chunkIndex,
            metadata: result.metadata,
            similarity: 1 - result.distance,
          })),
          query: validatedData.query,
          knowledgeBaseIds: foundKbIds,
          knowledgeBaseId: foundKbIds[0],
          topK: validatedData.topK,
          totalResults: results.length,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to perform vector search',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
