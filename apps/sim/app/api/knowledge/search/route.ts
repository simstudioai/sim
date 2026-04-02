import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
import {
  parseEmbeddingModel,
  searchKBTable,
  searchKBTableTagOnly,
} from '@/lib/knowledge/dynamic-tables'
import { generateSearchEmbedding, getOllamaBaseUrl } from '@/lib/knowledge/embeddings'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { buildUndefinedTagsError, validateTagValue } from '@/lib/knowledge/tags/utils'
import type { ExtendedChunkingConfig, StructuredFilter } from '@/lib/knowledge/types'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import {
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
  fieldType: z.enum(['text', 'number', 'date', 'boolean']).optional(),
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

    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    if (workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status }
        )
      }
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
        const kbTagDefs = await Promise.all(
          accessibleKbIds.map(async (kbId) => ({
            kbId,
            tagDefs: await getDocumentTagDefinitions(kbId),
          }))
        )

        const displayNameToTagDef: Record<string, { tagSlot: string; fieldType: string }> = {}
        for (const { kbId, tagDefs } of kbTagDefs) {
          const perKbMap = new Map(
            tagDefs.map((def) => [
              def.displayName,
              { tagSlot: def.tagSlot, fieldType: def.fieldType },
            ])
          )

          for (const filter of validatedData.tagFilters) {
            const current = perKbMap.get(filter.tagName)
            if (!current) {
              if (accessibleKbIds.length > 1) {
                return NextResponse.json(
                  {
                    error: `Tag "${filter.tagName}" does not exist in all selected knowledge bases. Search those knowledge bases separately.`,
                  },
                  { status: 400 }
                )
              }
              continue
            }

            const existing = displayNameToTagDef[filter.tagName]
            if (
              existing &&
              (existing.tagSlot !== current.tagSlot || existing.fieldType !== current.fieldType)
            ) {
              return NextResponse.json(
                {
                  error: `Tag "${filter.tagName}" is not mapped consistently across the selected knowledge bases. Search those knowledge bases separately.`,
                },
                { status: 400 }
              )
            }

            displayNameToTagDef[filter.tagName] = current
          }

          logger.debug(`[${requestId}] Loaded tag definitions for KB ${kbId}`, {
            tagCount: tagDefs.length,
          })
        }

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
          const tagSlot = tagDef.tagSlot
          const fieldType = tagDef.fieldType

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
      }

      if (accessibleKbIds.length === 0) {
        return NextResponse.json(
          { error: 'Knowledge base not found or access denied' },
          { status: 404 }
        )
      }

      const workspaceId = accessChecks.find((ac) => ac?.hasAccess)?.knowledgeBase?.workspaceId

      // Check if any requested knowledge bases were not accessible
      const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))

      if (inaccessibleKbIds.length > 0) {
        return NextResponse.json(
          { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
          { status: 404 }
        )
      }

      if (workflowId) {
        const authorization = await authorizeWorkflowByWorkspacePermission({
          workflowId,
          userId,
          action: 'read',
        })
        const workflowWorkspaceId = authorization.workflow?.workspaceId ?? null
        if (
          workflowWorkspaceId &&
          accessChecks.some(
            (accessCheck) =>
              accessCheck?.hasAccess &&
              accessCheck.knowledgeBase?.workspaceId !== workflowWorkspaceId
          )
        ) {
          return NextResponse.json(
            { error: 'Knowledge base does not belong to the workflow workspace' },
            { status: 400 }
          )
        }
      }

      // Fetch KB configs to determine provider routing
      const kbConfigRows = await db
        .select({
          id: knowledgeBase.id,
          embeddingModel: knowledgeBase.embeddingModel,
          chunkingConfig: knowledgeBase.chunkingConfig,
        })
        .from(knowledgeBase)
        .where(inArray(knowledgeBase.id, accessibleKbIds))

      const kbConfigMap = new Map(kbConfigRows.map((kb) => [kb.id, kb]))

      const openaiKbIds: string[] = []
      const ollamaKbIds: string[] = []

      for (const kbId of accessibleKbIds) {
        const config = kbConfigMap.get(kbId)
        if (!config) continue
        const { provider } = parseEmbeddingModel(config.embeddingModel)
        if (provider === 'ollama') {
          ollamaKbIds.push(kbId)
        } else {
          openaiKbIds.push(kbId)
        }
      }

      const hasQuery = validatedData.query && validatedData.query.trim().length > 0
      const hasFilters = structuredFilters && structuredFilters.length > 0

      // Generate OpenAI search embedding using the KB's configured model
      let openaiQueryVector: string | null = null
      let openaiEmbeddingModel = 'text-embedding-3-small'
      if (hasQuery && openaiKbIds.length > 0) {
        const firstOpenaiConfig = kbConfigMap.get(openaiKbIds[0])
        if (firstOpenaiConfig) {
          openaiEmbeddingModel = firstOpenaiConfig.embeddingModel
        }
        const emb = await generateSearchEmbedding(
          validatedData.query!,
          openaiEmbeddingModel,
          workspaceId
        )
        openaiQueryVector = JSON.stringify(emb)
      }

      // Generate Ollama search embeddings — one per unique (model, url) pair
      const ollamaQueryVectors = new Map<string, string>()
      if (hasQuery && ollamaKbIds.length > 0) {
        const uniquePairs = new Map<string, { modelName: string; ollamaBaseUrl: string }>()
        for (const kbId of ollamaKbIds) {
          const config = kbConfigMap.get(kbId)!
          const cfg = config.chunkingConfig as ExtendedChunkingConfig
          const { modelName } = parseEmbeddingModel(config.embeddingModel)
          const baseUrl = getOllamaBaseUrl(cfg.ollamaBaseUrl)
          uniquePairs.set(`${modelName}:${baseUrl}`, { modelName, ollamaBaseUrl: baseUrl })
        }
        await Promise.all(
          Array.from(uniquePairs.entries()).map(async ([pairKey, { modelName, ollamaBaseUrl }]) => {
            const emb = await generateSearchEmbedding(
              validatedData.query!,
              `ollama/${modelName}`,
              undefined,
              ollamaBaseUrl
            )
            ollamaQueryVectors.set(pairKey, JSON.stringify(emb))
          })
        )
      }

      const allResults: SearchResult[] = []

      // OpenAI KBs — existing search handlers
      if (openaiKbIds.length > 0) {
        const strategy = getQueryStrategy(openaiKbIds.length, validatedData.topK)

        if (!hasQuery && hasFilters) {
          allResults.push(
            ...(await handleTagOnlySearch({
              knowledgeBaseIds: openaiKbIds,
              topK: validatedData.topK,
              structuredFilters,
            }))
          )
        } else if (hasQuery && hasFilters && openaiQueryVector) {
          logger.debug(
            `[${requestId}] Executing tag + vector search with filters:`,
            structuredFilters
          )
          allResults.push(
            ...(await handleTagAndVectorSearch({
              knowledgeBaseIds: openaiKbIds,
              topK: validatedData.topK,
              structuredFilters,
              queryVector: openaiQueryVector,
              distanceThreshold: strategy.distanceThreshold,
            }))
          )
        } else if (hasQuery && openaiQueryVector) {
          allResults.push(
            ...(await handleVectorOnlySearch({
              knowledgeBaseIds: openaiKbIds,
              topK: validatedData.topK,
              queryVector: openaiQueryVector,
              distanceThreshold: strategy.distanceThreshold,
            }))
          )
        }
      }

      // Ollama KBs — per-KB table search
      for (const kbId of ollamaKbIds) {
        const config = kbConfigMap.get(kbId)!
        const cfg = config.chunkingConfig as ExtendedChunkingConfig
        const { modelName } = parseEmbeddingModel(config.embeddingModel)
        const baseUrl = getOllamaBaseUrl(cfg.ollamaBaseUrl)
        const pairKey = `${modelName}:${baseUrl}`
        const strategy = getQueryStrategy(1, validatedData.topK)

        if (!hasQuery && hasFilters) {
          allResults.push(
            ...(await searchKBTableTagOnly(kbId, validatedData.topK, structuredFilters))
          )
        } else if (hasQuery) {
          const queryVector = ollamaQueryVectors.get(pairKey)
          if (queryVector) {
            allResults.push(
              ...(await searchKBTable(
                kbId,
                queryVector,
                validatedData.topK,
                strategy.distanceThreshold,
                hasFilters ? structuredFilters : undefined
              ))
            )
          }
        }
      }

      // Normalize scores globally across all results before ranking.
      // Per-provider normalization would inflate a poor single-provider result
      // to an artificially high rank when merging across embedding spaces.
      const normalizeScores = (items: SearchResult[]): SearchResult[] => {
        if (items.length === 0) return items
        // Single result: clamp raw distance to [0,1] to preserve quality signal.
        // Forcing distance=0 would give a poor single result the best possible rank.
        if (items.length === 1)
          return [{ ...items[0], distance: Math.min(1, Math.max(0, items[0].distance)) }]
        const min = Math.min(...items.map((r) => r.distance))
        const max = Math.max(...items.map((r) => r.distance))
        const range = max - min || 1
        return items.map((r) => ({ ...r, distance: (r.distance - min) / range }))
      }

      const results: SearchResult[] = normalizeScores(allResults)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, validatedData.topK)

      // Calculate cost — only for OpenAI embedding calls
      let cost = null
      let tokenCount = null
      if (hasQuery && openaiKbIds.length > 0) {
        try {
          tokenCount = estimateTokenCount(validatedData.query!, 'openai')
          cost = calculateCost(openaiEmbeddingModel, tokenCount.count, 0, false)
        } catch (error) {
          logger.warn(`[${requestId}] Failed to calculate cost for search query`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
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
            const tags: Record<string, string | number | boolean | Date | null> = {}

            ALL_TAG_SLOTS.forEach((slot) => {
              const tagValue = result[slot as keyof SearchResult]
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
                  model: openaiEmbeddingModel,
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
