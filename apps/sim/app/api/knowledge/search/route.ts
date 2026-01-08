import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { buildUndefinedTagsError, validateTagValue } from '@/lib/knowledge/tags/utils'
import type { StructuredFilter } from '@/lib/knowledge/types'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { getUserId } from '@/app/api/auth/oauth/utils'
import {
  generateSearchEmbedding,
  getDocumentNamesByIds,
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type SearchResult,
} from '@/app/api/knowledge/search/utils'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('VectorSearchAPI')

/** Structured tag filter with operator support */
const StructuredTagFilterSchema = z.object({
  tagName: z.string(),
  tagSlot: z.string().optional(),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']).default('text'),
  operator: z.string().default('eq'),
  value: z.union([z.string(), z.number(), z.boolean()]),
  valueTo: z.union([z.string(), z.number()]).optional(),
})

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
    tagFilters: z
      .array(StructuredTagFilterSchema)
      .optional()
      .nullable()
      .transform((val) => val || undefined),
  })
  .refine(
    (data) => {
      const hasQuery = data.query && data.query.trim().length > 0
      const hasTagFilters = data.tagFilters && data.tagFilters.length > 0
      return hasQuery || hasTagFilters
    },
    {
      message: 'Please provide either a search query or tag filters to search your knowledge base',
    }
  )

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

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

      // Check access permissions in parallel for performance
      const accessChecks = await Promise.all(
        knowledgeBaseIds.map((kbId) => checkKnowledgeBaseAccess(kbId, userId))
      )
      const accessibleKbIds: string[] = knowledgeBaseIds.filter(
        (_, idx) => accessChecks[idx]?.hasAccess
      )

      // Map display names to tag slots for filtering
      let structuredFilters: StructuredFilter[] = []

      // Handle tag filters
      if (validatedData.tagFilters && accessibleKbIds.length > 0) {
        const kbId = accessibleKbIds[0]
        const tagDefs = await getDocumentTagDefinitions(kbId)

        // Create mapping from display name to tag slot and fieldType
        const displayNameToTagDef: Record<string, { tagSlot: string; fieldType: string }> = {}
        tagDefs.forEach((def) => {
          displayNameToTagDef[def.displayName] = {
            tagSlot: def.tagSlot,
            fieldType: def.fieldType,
          }
        })

        // Validate all tag filters first
        const undefinedTags: string[] = []
        const typeErrors: string[] = []

        for (const filter of validatedData.tagFilters) {
          const tagDef = displayNameToTagDef[filter.tagName]

          // Check if tag exists
          if (!tagDef) {
            undefinedTags.push(filter.tagName)
            continue
          }

          // Validate value type using shared validation
          const validationError = validateTagValue(
            filter.tagName,
            String(filter.value),
            tagDef.fieldType
          )
          if (validationError) {
            typeErrors.push(validationError)
          }
        }

        // Throw combined error if there are any validation issues
        if (undefinedTags.length > 0 || typeErrors.length > 0) {
          const errorParts: string[] = []

          if (undefinedTags.length > 0) {
            errorParts.push(buildUndefinedTagsError(undefinedTags))
          }

          if (typeErrors.length > 0) {
            errorParts.push(...typeErrors)
          }

          return NextResponse.json({ error: errorParts.join('\n') }, { status: 400 })
        }

        // Build structured filters with validated data
        structuredFilters = validatedData.tagFilters.map((filter) => {
          const tagDef = displayNameToTagDef[filter.tagName]!
          const tagSlot = filter.tagSlot || tagDef.tagSlot
          const fieldType = filter.fieldType || tagDef.fieldType

          logger.debug(
            `[${requestId}] Structured filter: ${filter.tagName} -> ${tagSlot} (${fieldType}) ${filter.operator} ${filter.value}`
          )

          return {
            tagSlot,
            fieldType,
            operator: filter.operator,
            value: filter.value,
            valueTo: filter.valueTo,
          }
        })

        logger.debug(`[${requestId}] Processed ${structuredFilters.length} structured filters`)
      }

      if (accessibleKbIds.length === 0) {
        return NextResponse.json(
          { error: 'Knowledge base not found or access denied' },
          { status: 404 }
        )
      }

      const workspaceId = accessChecks.find((ac) => ac?.hasAccess)?.knowledgeBase?.workspaceId

      const hasQuery = validatedData.query && validatedData.query.trim().length > 0
      const queryEmbeddingPromise = hasQuery
        ? generateSearchEmbedding(validatedData.query!, undefined, workspaceId)
        : Promise.resolve(null)

      // Check if any requested knowledge bases were not accessible
      const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))

      if (inaccessibleKbIds.length > 0) {
        return NextResponse.json(
          { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
          { status: 404 }
        )
      }

      let results: SearchResult[]

      const hasFilters = structuredFilters && structuredFilters.length > 0

      if (!hasQuery && hasFilters) {
        // Tag-only search without vector similarity
        logger.debug(`[${requestId}] Executing tag-only search with filters:`, structuredFilters)
        results = await handleTagOnlySearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          structuredFilters,
        })
      } else if (hasQuery && hasFilters) {
        // Tag + Vector search
        logger.debug(
          `[${requestId}] Executing tag + vector search with filters:`,
          structuredFilters
        )
        const strategy = getQueryStrategy(accessibleKbIds.length, validatedData.topK)
        const queryVector = JSON.stringify(await queryEmbeddingPromise)

        results = await handleTagAndVectorSearch({
          knowledgeBaseIds: accessibleKbIds,
          topK: validatedData.topK,
          structuredFilters,
          queryVector,
          distanceThreshold: strategy.distanceThreshold,
        })
      } else if (hasQuery && !hasFilters) {
        // Vector-only search
        logger.debug(`[${requestId}] Executing vector-only search`)
        const strategy = getQueryStrategy(accessibleKbIds.length, validatedData.topK)
        const queryVector = JSON.stringify(await queryEmbeddingPromise)

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
      const tagDefsResults = await Promise.all(
        accessibleKbIds.map(async (kbId) => {
          try {
            const tagDefs = await getDocumentTagDefinitions(kbId)
            const map: Record<string, string> = {}
            tagDefs.forEach((def) => {
              map[def.tagSlot] = def.displayName
            })
            return { kbId, map }
          } catch (error) {
            logger.warn(
              `[${requestId}] Failed to fetch tag definitions for display mapping:`,
              error
            )
            return { kbId, map: {} as Record<string, string> }
          }
        })
      )
      const tagDefinitionsMap: Record<string, Record<string, string>> = {}
      tagDefsResults.forEach(({ kbId, map }) => {
        tagDefinitionsMap[kbId] = map
      })

      // Fetch document names for the results
      const documentIds = results.map((result) => result.documentId)
      const documentNameMap = await getDocumentNamesByIds(documentIds)

      try {
        PlatformEvents.knowledgeBaseSearched({
          knowledgeBaseId: accessibleKbIds[0],
          resultsCount: results.length,
          workspaceId: workspaceId || undefined,
        })
      } catch {
        // Telemetry should not fail the operation
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

            ALL_TAG_SLOTS.forEach((slot) => {
              const tagValue = (result as any)[slot]
              if (tagValue !== null && tagValue !== undefined) {
                const displayName = kbTagMap[slot] || slot
                logger.debug(
                  `[${requestId}] Mapping ${slot}="${tagValue}" -> "${displayName}"="${tagValue}"`
                )
                tags[displayName] = tagValue
              }
            })

            return {
              documentId: result.documentId,
              documentName: documentNameMap[result.documentId] || undefined,
              content: result.content,
              chunkIndex: result.chunkIndex,
              metadata: tags, // Clean display name mapped tags
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
