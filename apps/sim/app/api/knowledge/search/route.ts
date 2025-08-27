import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { TAG_SLOTS } from '@/lib/constants/knowledge'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { calculateCost } from '@/providers/utils'
import {
  generateSearchEmbedding,
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type SearchResult,
} from './utils'

const logger = createLogger('VectorSearchAPI')

const VectorSearchSchema = z
  .object({
    knowledgeBaseIds: z.union([
      z.string().min(1, 'Knowledge base ID is required'),
      z.array(z.string().min(1)).min(1, 'At least one knowledge base ID is required'),
    ]),
    query: z
      .string()
      .optional()
      .nullable()
      .transform((val) => val || undefined),
    topK: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .nullable()
      .default(10)
      .transform((val) => val ?? 10),
    filters: z
      .record(z.string())
      .optional()
      .nullable()
      .transform((val) => val || undefined), // Allow dynamic filter keys (display names)
  })
  .refine(
    (data) => {
      // Ensure at least query or filters are provided
      const hasQuery = data.query && data.query.trim().length > 0
      const hasFilters = data.filters && Object.keys(data.filters).length > 0
      return hasQuery || hasFilters
    },
    {
      message: 'Please provide either a search query or tag filters to search your knowledge base',
    }
  )

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
          const tagDefs = await getDocumentTagDefinitions(kbId)

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

      // Generate query embedding only if query is provided
      const hasQuery = validatedData.query && validatedData.query.trim().length > 0
      const queryEmbedding = hasQuery ? await generateSearchEmbedding(validatedData.query!) : null

      // Check if any requested knowledge bases were not accessible
      const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))

      if (inaccessibleKbIds.length > 0) {
        return NextResponse.json(
          { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
          { status: 404 }
        )
      }

      let results: SearchResult[]

      const hasFilters = mappedFilters && Object.keys(mappedFilters).length > 0

      if (!hasQuery && hasFilters) {
        // Tag-only search without vector similarity
        logger.debug(`[${requestId}] Executing tag-only search with filters:`, mappedFilters)
        results = await handleTagOnlySearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          filters: mappedFilters,
        })
      } else if (hasQuery && hasFilters) {
        // Tag + Vector search
        logger.debug(`[${requestId}] Executing tag + vector search with filters:`, mappedFilters)
        const strategy = getQueryStrategy(accessibleKbIds.length, validatedData.topK)
        const queryVector = JSON.stringify(queryEmbedding)

        results = await handleTagAndVectorSearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          filters: mappedFilters,
          queryVector,
          distanceThreshold: strategy.distanceThreshold,
        })
      } else if (hasQuery && !hasFilters) {
        // Vector-only search
        logger.debug(`[${requestId}] Executing vector-only search`)
        const strategy = getQueryStrategy(accessibleKbIds.length, validatedData.topK)
        const queryVector = JSON.stringify(queryEmbedding)

        results = await handleVectorOnlySearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          queryVector,
          distanceThreshold: strategy.distanceThreshold,
        })
      } else {
        // This should never happen due to schema validation, but just in case
        return NextResponse.json(
          {
            error:
              'Please provide either a search query or tag filters to search your knowledge base',
          },
          { status: 400 }
        )
      }

      // Calculate cost for the embedding (with fallback if calculation fails)
      let cost = null
      let tokenCount = null
      if (hasQuery) {
        try {
          tokenCount = estimateTokenCount(validatedData.query!, 'openai')
          cost = calculateCost('text-embedding-3-small', tokenCount.count, 0, false)
        } catch (error) {
          logger.warn(`[${requestId}] Failed to calculate cost for search query`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
          // Continue without cost information rather than failing the search
        }
      }

      // Fetch tag definitions for display name mapping (reuse the same fetch from filtering)
      const tagDefinitionsMap: Record<string, Record<string, string>> = {}
      for (const kbId of accessibleKbIds) {
        try {
          const tagDefs = await getDocumentTagDefinitions(kbId)

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
              const tagValue = (result as any)[slot]
              if (tagValue) {
                const displayName = kbTagMap[slot] || slot
                logger.debug(
                  `[${requestId}] Mapping ${slot}="${tagValue}" -> "${displayName}"="${tagValue}"`
                )
                tags[displayName] = tagValue
              }
            })

            return {
              id: result.id,
              content: result.content,
              documentId: result.documentId,
              chunkIndex: result.chunkIndex,
              tags, // Clean display name mapped tags
              similarity: hasQuery ? 1 - result.distance : 1, // Perfect similarity for tag-only searches
            }
          }),
          query: validatedData.query || '',
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
