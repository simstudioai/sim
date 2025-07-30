import { and, eq, inArray, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { TAG_SLOTS } from '@/lib/constants/knowledge'
import { retryWithExponentialBackoff } from '@/lib/documents/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { embedding, knowledgeBaseTagDefinitions } from '@/db/schema'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('VectorSearchAPI')

function getTagFilters(filters: Record<string, string>, embedding: any) {
  return Object.entries(filters).map(([key, value]) => {
    // Handle OR logic within same tag
    const values = value.includes('|OR|') ? value.split('|OR|') : [value]
    logger.debug(`[getTagFilters] Processing ${key}="${value}" -> values:`, values)

    const getColumnForKey = (key: string) => {
      switch (key) {
        case 'tag1':
          return embedding.tag1
        case 'tag2':
          return embedding.tag2
        case 'tag3':
          return embedding.tag3
        case 'tag4':
          return embedding.tag4
        case 'tag5':
          return embedding.tag5
        case 'tag6':
          return embedding.tag6
        case 'tag7':
          return embedding.tag7
        default:
          return null
      }
    }

    const column = getColumnForKey(key)
    if (!column) return sql`1=1` // No-op for unknown keys

    if (values.length === 1) {
      // Single value - simple equality
      logger.debug(`[getTagFilters] Single value filter: ${key} = ${values[0]}`)
      return sql`LOWER(${column}) = LOWER(${values[0]})`
    }
    // Multiple values - OR logic
    logger.debug(`[getTagFilters] OR filter: ${key} IN (${values.join(', ')})`)
    const orConditions = values.map((v) => sql`LOWER(${column}) = LOWER(${v})`)
    return sql`(${sql.join(orConditions, sql` OR `)})`
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
  filters: z.record(z.string()).optional(), // Allow dynamic filter keys (display names)
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
  logger.debug(`[executeSingleQuery] Called with filters:`, filters)
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
      knowledgeBaseId: embedding.knowledgeBaseId,
    })
    .from(embedding)
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        eq(embedding.enabled, true),
        sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`,
        ...(filters ? getTagFilters(filters, embedding) : [])
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

      // Map display names to tag slots for filtering
      let mappedFilters: Record<string, string> = {}
      if (validatedData.filters && accessibleKbIds.length > 0) {
        try {
          // Fetch tag definitions for the first accessible KB (since we're using single KB now)
          const kbId = accessibleKbIds[0]
          const tagDefs = await db
            .select({
              tagSlot: knowledgeBaseTagDefinitions.tagSlot,
              displayName: knowledgeBaseTagDefinitions.displayName,
            })
            .from(knowledgeBaseTagDefinitions)
            .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, kbId))

          logger.debug(`[${requestId}] Found tag definitions:`, tagDefs)
          logger.debug(`[${requestId}] Original filters:`, validatedData.filters)

          // Create mapping from display name to tag slot
          const displayNameToSlot: Record<string, string> = {}
          tagDefs.forEach((def) => {
            displayNameToSlot[def.displayName] = def.tagSlot
          })

          // Map the filters and handle OR logic
          Object.entries(validatedData.filters).forEach(([key, value]) => {
            if (value) {
              const tagSlot = displayNameToSlot[key] || key // Fallback to key if no mapping found

              // Check if this is an OR filter (contains |OR| separator)
              if (value.includes('|OR|')) {
                logger.debug(
                  `[${requestId}] OR filter detected: "${key}" -> "${tagSlot}" = "${value}"`
                )
              }

              mappedFilters[tagSlot] = value
              logger.debug(`[${requestId}] Mapped filter: "${key}" -> "${tagSlot}" = "${value}"`)
            }
          })

          logger.debug(`[${requestId}] Final mapped filters:`, mappedFilters)
        } catch (error) {
          logger.error(`[${requestId}] Filter mapping error:`, error)
          // If mapping fails, use original filters
          mappedFilters = validatedData.filters
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
        logger.debug(`[${requestId}] Executing parallel queries with filters:`, mappedFilters)
        const parallelResults = await executeParallelQueries(
          accessibleKbIds,
          queryVector,
          validatedData.topK,
          strategy.distanceThreshold,
          mappedFilters
        )
        results = mergeAndRankResults(parallelResults, validatedData.topK)
      } else {
        // Execute single optimized query for fewer KBs
        logger.debug(`[${requestId}] Executing single query with filters:`, mappedFilters)
        results = await executeSingleQuery(
          accessibleKbIds,
          queryVector,
          validatedData.topK,
          strategy.distanceThreshold,
          mappedFilters
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

      // Fetch tag definitions for display name mapping (reuse the same fetch from filtering)
      const tagDefinitionsMap: Record<string, Record<string, string>> = {}
      for (const kbId of accessibleKbIds) {
        try {
          const tagDefs = await db
            .select({
              tagSlot: knowledgeBaseTagDefinitions.tagSlot,
              displayName: knowledgeBaseTagDefinitions.displayName,
            })
            .from(knowledgeBaseTagDefinitions)
            .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, kbId))

          tagDefinitionsMap[kbId] = {}
          tagDefs.forEach((def) => {
            tagDefinitionsMap[kbId][def.tagSlot] = def.displayName
          })
          logger.debug(
            `[${requestId}] Display mapping - KB ${kbId} tag definitions:`,
            tagDefinitionsMap[kbId]
          )
        } catch (error) {
          logger.warn(`[${requestId}] Failed to fetch tag definitions for display mapping:`, error)
          tagDefinitionsMap[kbId] = {}
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          results: results.map((result) => {
            const kbTagMap = tagDefinitionsMap[result.knowledgeBaseId] || {}
            logger.debug(
              `[${requestId}] Result KB: ${result.knowledgeBaseId}, available mappings:`,
              kbTagMap
            )

            // Create tags object with display names
            const tags: Record<string, any> = {}

            TAG_SLOTS.forEach((slot) => {
              if (result[slot]) {
                const displayName = kbTagMap[slot] || slot
                logger.debug(
                  `[${requestId}] Mapping ${slot}="${result[slot]}" -> "${displayName}"="${result[slot]}"`
                )
                tags[displayName] = result[slot]
              }
            })

            return {
              id: result.id,
              content: result.content,
              documentId: result.documentId,
              chunkIndex: result.chunkIndex,
              tags, // Clean display name mapped tags
              similarity: 1 - result.distance,
            }
          }),
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
