import { and, eq, inArray, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { retryWithExponentialBackoff } from '@/lib/documents/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { embedding } from '@/db/schema'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('VectorSearchAPI')

function getTagFilters(filters: Record<string, string>, embedding: any) {
  return Object.entries(filters).map(([key, value]) => {
    switch (key) {
      case 'tag1':
        return sql`LOWER(${embedding.tag1}) = LOWER(${value})`
      case 'tag2':
        return sql`LOWER(${embedding.tag2}) = LOWER(${value})`
      case 'tag3':
        return sql`LOWER(${embedding.tag3}) = LOWER(${value})`
      case 'tag4':
        return sql`LOWER(${embedding.tag4}) = LOWER(${value})`
      case 'tag5':
        return sql`LOWER(${embedding.tag5}) = LOWER(${value})`
      case 'tag6':
        return sql`LOWER(${embedding.tag6}) = LOWER(${value})`
      case 'tag7':
        return sql`LOWER(${embedding.tag7}) = LOWER(${value})`
      default:
        return sql`1=1` // No-op for unknown keys
    }
  })
}

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
  filters: z
    .object({
      tag1: z.string().optional(),
      tag2: z.string().optional(),
      tag3: z.string().optional(),
      tag4: z.string().optional(),
      tag5: z.string().optional(),
      tag6: z.string().optional(),
      tag7: z.string().optional(),
    })
    .optional(),
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
  distanceThreshold: number,
  filters?: Record<string, string>
) {
  const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5

  const queryPromises = knowledgeBaseIds.map(async (kbId) => {
    const results = await db
      .select({
        id: embedding.id,
        content: embedding.content,
        documentId: embedding.documentId,
        chunkIndex: embedding.chunkIndex,
        tag1: embedding.tag1,
        tag2: embedding.tag2,
        tag3: embedding.tag3,
        tag4: embedding.tag4,
        tag5: embedding.tag5,
        tag6: embedding.tag6,
        tag7: embedding.tag7,
        distance: sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance'),
        knowledgeBaseId: embedding.knowledgeBaseId,
      })
      .from(embedding)
      .where(
        and(
          eq(embedding.knowledgeBaseId, kbId),
          eq(embedding.enabled, true),
          sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`,
          ...(filters ? getTagFilters(filters, embedding) : [])
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
  distanceThreshold: number,
  filters?: Record<string, string>
) {
  return await db
    .select({
      id: embedding.id,
      content: embedding.content,
      documentId: embedding.documentId,
      chunkIndex: embedding.chunkIndex,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      distance: sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance'),
    })
    .from(embedding)
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        eq(embedding.enabled, true),
        sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`,
        ...(filters
          ? Object.entries(filters).map(([key, value]) => {
              switch (key) {
                case 'tag1':
                  return sql`LOWER(${embedding.tag1}) = LOWER(${value})`
                case 'tag2':
                  return sql`LOWER(${embedding.tag2}) = LOWER(${value})`
                case 'tag3':
                  return sql`LOWER(${embedding.tag3}) = LOWER(${value})`
                case 'tag4':
                  return sql`LOWER(${embedding.tag4}) = LOWER(${value})`
                case 'tag5':
                  return sql`LOWER(${embedding.tag5}) = LOWER(${value})`
                case 'tag6':
                  return sql`LOWER(${embedding.tag6}) = LOWER(${value})`
                case 'tag7':
                  return sql`LOWER(${embedding.tag7}) = LOWER(${value})`
                default:
                  return sql`1=1` // No-op for unknown keys
              }
            })
          : [])
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

      // Check access permissions for each knowledge base using proper workspace-based permissions
      const accessibleKbIds: string[] = []
      for (const kbId of knowledgeBaseIds) {
        const accessCheck = await checkKnowledgeBaseAccess(kbId, userId)
        if (accessCheck.hasAccess) {
          accessibleKbIds.push(kbId)
        }
      }

      if (accessibleKbIds.length === 0) {
        return NextResponse.json(
          { error: 'Knowledge base not found or access denied' },
          { status: 404 }
        )
      }

      // Generate query embedding in parallel with access checks
      const queryEmbedding = await generateSearchEmbedding(validatedData.query)

      // Check if any requested knowledge bases were not accessible
      const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))

      if (inaccessibleKbIds.length > 0) {
        return NextResponse.json(
          { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
          { status: 404 }
        )
      }

      // Adaptive query strategy based on accessible KB count and parameters
      const strategy = getQueryStrategy(accessibleKbIds.length, validatedData.topK)
      const queryVector = JSON.stringify(queryEmbedding)

      let results: any[]

      if (strategy.useParallel) {
        // Execute parallel queries for better performance with many KBs
        const parallelResults = await executeParallelQueries(
          accessibleKbIds,
          queryVector,
          validatedData.topK,
          strategy.distanceThreshold,
          validatedData.filters
        )
        results = mergeAndRankResults(parallelResults, validatedData.topK)
      } else {
        // Execute single optimized query for fewer KBs
        results = await executeSingleQuery(
          accessibleKbIds,
          queryVector,
          validatedData.topK,
          strategy.distanceThreshold,
          validatedData.filters
        )
      }

      // Calculate cost for the embedding (with fallback if calculation fails)
      let cost = null
      let tokenCount = null
      try {
        tokenCount = estimateTokenCount(validatedData.query, 'openai')
        cost = calculateCost('text-embedding-3-small', tokenCount.count, 0, false)
      } catch (error) {
        logger.warn(`[${requestId}] Failed to calculate cost for search query`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        // Continue without cost information rather than failing the search
      }

      return NextResponse.json({
        success: true,
        data: {
          results: results.map((result) => ({
            id: result.id,
            content: result.content,
            documentId: result.documentId,
            chunkIndex: result.chunkIndex,
            tag1: result.tag1,
            tag2: result.tag2,
            tag3: result.tag3,
            tag4: result.tag4,
            tag5: result.tag5,
            tag6: result.tag6,
            tag7: result.tag7,
            similarity: 1 - result.distance,
          })),
          query: validatedData.query,
          knowledgeBaseIds: accessibleKbIds,
          knowledgeBaseId: accessibleKbIds[0],
          topK: validatedData.topK,
          totalResults: results.length,
          ...(cost && tokenCount
            ? {
                cost: {
                  input: cost.input,
                  output: cost.output,
                  total: cost.total,
                  tokens: {
                    prompt: tokenCount.count,
                    completion: 0,
                    total: tokenCount.count,
                  },
                  model: 'text-embedding-3-small',
                  pricing: cost.pricing,
                },
              }
            : {}),
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
