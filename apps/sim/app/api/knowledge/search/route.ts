import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import { knowledgeSearchBodySchema } from '@/lib/api/contracts/knowledge'
import { parseJsonBody, validationErrorResponse } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
import { getEmbeddingModelInfo } from '@/lib/knowledge/embedding-models'
import { rerank } from '@/lib/knowledge/reranker'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { buildUndefinedTagsError, validateTagValue } from '@/lib/knowledge/tags/utils'
import type { StructuredFilter } from '@/lib/knowledge/types'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import {
  generateSearchEmbedding,
  getDocumentNamesByIds,
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type SearchResult,
} from '@/app/api/knowledge/search/utils'
import { checkKnowledgeBaseAccess, type KnowledgeBaseAccessResult } from '@/app/api/knowledge/utils'
import { getRerankModelPricing } from '@/providers/models'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('VectorSearchAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsedBody = await parseJsonBody(request)
    if (!parsedBody.success) return parsedBody.response
    const body = parsedBody.data as Record<string, unknown>
    const { workflowId, ...searchParams } = body

    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    if (workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: workflowId as string,
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

    const validation = knowledgeSearchBodySchema.safeParse(searchParams)
    if (!validation.success) return validationErrorResponse(validation.error)
    const validatedData = validation.data

    const knowledgeBaseIds = Array.isArray(validatedData.knowledgeBaseIds)
      ? validatedData.knowledgeBaseIds
      : [validatedData.knowledgeBaseIds]

    const accessChecks = await Promise.all(
      knowledgeBaseIds.map((kbId) => checkKnowledgeBaseAccess(kbId, userId))
    )
    const accessibleKbIds: string[] = knowledgeBaseIds.filter(
      (_, idx) => accessChecks[idx]?.hasAccess
    )

    let structuredFilters: StructuredFilter[] = []

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

      const undefinedTags: string[] = []
      const typeErrors: string[] = []

      for (const filter of validatedData.tagFilters) {
        const tagDef = displayNameToTagDef[filter.tagName]

        if (!tagDef) {
          undefinedTags.push(filter.tagName)
          continue
        }

        const validationError = validateTagValue(
          filter.tagName,
          String(filter.value),
          tagDef.fieldType
        )
        if (validationError) {
          typeErrors.push(validationError)
        }
      }

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

    const accessibleKbs = accessChecks
      .filter((ac): ac is KnowledgeBaseAccessResult => Boolean(ac?.hasAccess))
      .map((ac) => ac.knowledgeBase)
    const workspaceId = accessibleKbs[0]?.workspaceId

    const useReranker = validatedData.rerankerEnabled && Boolean(validatedData.query?.trim())
    const rerankerModel = useReranker ? validatedData.rerankerModel : null

    const hasQuery = validatedData.query && validatedData.query.trim().length > 0
    const embeddingModels = Array.from(new Set(accessibleKbs.map((kb) => kb.embeddingModel)))
    if (hasQuery && embeddingModels.length > 1) {
      return NextResponse.json(
        {
          error:
            'Selected knowledge bases use different embedding models and cannot be searched together. Search them separately.',
        },
        { status: 400 }
      )
    }
    const queryEmbeddingModel = embeddingModels[0]

    const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))

    if (inaccessibleKbIds.length > 0) {
      return NextResponse.json(
        { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
        { status: 404 }
      )
    }

    const queryEmbeddingPromise = hasQuery
      ? generateSearchEmbedding(validatedData.query!, queryEmbeddingModel, workspaceId)
      : Promise.resolve(null)

    if (workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: workflowId as string,
        userId,
        action: 'read',
      })
      const workflowWorkspaceId = authorization.workflow?.workspaceId ?? null
      if (
        workflowWorkspaceId &&
        accessChecks.some(
          (accessCheck) =>
            accessCheck?.hasAccess && accessCheck.knowledgeBase?.workspaceId !== workflowWorkspaceId
        )
      ) {
        return NextResponse.json(
          { error: 'Knowledge base does not belong to the workflow workspace' },
          { status: 400 }
        )
      }
    }

    let results: SearchResult[]

    const hasFilters = structuredFilters && structuredFilters.length > 0

    /** Oversample vector results when reranking so the reranker has more to choose from.
     * Cap at 100 to bound Cohere request cost (1 search unit = ≤100 docs). When the caller
     * supplies `rerankerInputCount`, honor it but never let it drop below `topK`
     * (which would defeat the purpose) or exceed 100 (which would split into >1 search units). */
    const rawInputCount = validatedData.rerankerInputCount
    if (useReranker && rawInputCount !== undefined && rawInputCount < validatedData.topK) {
      logger.warn(
        `[${requestId}] rerankerInputCount (${rawInputCount}) is below topK (${validatedData.topK}); raising to topK`
      )
    }
    const candidateTopK = useReranker
      ? rawInputCount !== undefined
        ? Math.min(100, Math.max(validatedData.topK, rawInputCount))
        : Math.min(100, validatedData.topK * 4)
      : validatedData.topK

    if (!hasQuery && hasFilters) {
      results = await handleTagOnlySearch({
        knowledgeBaseIds: accessibleKbIds,
        topK: validatedData.topK,
        structuredFilters,
      })
    } else if (hasQuery && hasFilters) {
      logger.debug(`[${requestId}] Executing tag + vector search with filters:`, structuredFilters)
      const strategy = getQueryStrategy(accessibleKbIds.length, candidateTopK)
      const queryVector = JSON.stringify(await queryEmbeddingPromise)

      results = await handleTagAndVectorSearch({
        knowledgeBaseIds: accessibleKbIds,
        topK: candidateTopK,
        structuredFilters,
        queryVector,
        distanceThreshold: strategy.distanceThreshold,
      })
    } else if (hasQuery && !hasFilters) {
      const strategy = getQueryStrategy(accessibleKbIds.length, candidateTopK)
      const queryVector = JSON.stringify(await queryEmbeddingPromise)

      results = await handleVectorOnlySearch({
        knowledgeBaseIds: accessibleKbIds,
        topK: candidateTopK,
        queryVector,
        distanceThreshold: strategy.distanceThreshold,
      })
    } else {
      return NextResponse.json(
        {
          error:
            'Please provide either a search query or tag filters to search your knowledge base',
        },
        { status: 400 }
      )
    }

    /** Optional Cohere rerank pass on top of vector results.
     * `rerankBilled` = Cohere was successfully called (even with 0 results) and we owe the search unit. */
    const rerankedScores = new Map<string, number>()
    let rerankBilled = false
    let rerankIsBYOK = false
    if (useReranker && rerankerModel && results.length > 0) {
      const candidateCount = results.length
      try {
        const { results: ranked, isBYOK } = await rerank(
          validatedData.query!,
          results.map((r) => ({ id: r.id, text: r.content })),
          {
            model: rerankerModel,
            topN: validatedData.topK,
            workspaceId,
            apiKey: validatedData.rerankerApiKey,
          }
        )
        rerankBilled = true
        rerankIsBYOK = isBYOK
        if (ranked.length === 0) {
          logger.warn(
            `[${requestId}] Reranker returned 0 results; falling back to vector ordering`,
            { model: rerankerModel, candidateCount }
          )
          results = results.slice(0, validatedData.topK)
        } else {
          const idToResult = new Map(results.map((r) => [r.id, r]))
          results = ranked
            .map((r) => idToResult.get(r.item.id))
            .filter((r): r is SearchResult => Boolean(r))
          for (const r of ranked) rerankedScores.set(r.item.id, r.relevanceScore)
          logger.info(`[${requestId}] Reranked ${candidateCount} → ${results.length} results`, {
            model: rerankerModel,
          })
        }
      } catch (error) {
        logger.warn(`[${requestId}] Reranker failed; falling back to vector ordering`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          model: rerankerModel,
          candidateCount,
          workspaceId,
        })
        results = results.slice(0, validatedData.topK)
      }
    } else if (useReranker) {
      results = results.slice(0, validatedData.topK)
    }

    let cost = null
    let tokenCount = null
    if (hasQuery) {
      try {
        tokenCount = estimateTokenCount(
          validatedData.query!,
          getEmbeddingModelInfo(queryEmbeddingModel).tokenizerProvider
        )
        cost = calculateCost(queryEmbeddingModel, tokenCount.count, 0, false)
      } catch (error) {
        logger.warn(`[${requestId}] Failed to calculate cost for search query`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    /** Add Cohere rerank cost (1 search unit per successful call, since we cap candidates ≤100).
     * Bill on every successful API response — Cohere charges even when 0 results are returned. */
    let rerankerCost = 0
    if (rerankBilled && rerankerModel && !rerankIsBYOK) {
      const pricing = getRerankModelPricing(rerankerModel)
      if (pricing) {
        rerankerCost = pricing.perSearchUnit
        if (cost) {
          cost = {
            ...cost,
            input: cost.input + rerankerCost,
            total: cost.total + rerankerCost,
          }
        } else {
          cost = {
            input: rerankerCost,
            output: 0,
            total: rerankerCost,
            pricing: { input: 0, output: 0, updatedAt: pricing.updatedAt },
          }
        }
      } else {
        logger.warn(`[${requestId}] No pricing entry for rerank model ${rerankerModel}`)
      }
    }

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
          logger.warn(`[${requestId}] Failed to fetch tag definitions for display mapping:`, error)
          return { kbId, map: {} as Record<string, string> }
        }
      })
    )
    const tagDefinitionsMap: Record<string, Record<string, string>> = {}
    tagDefsResults.forEach(({ kbId, map }) => {
      tagDefinitionsMap[kbId] = map
    })

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

          const rerankerScore = rerankedScores.get(result.id)
          return {
            documentId: result.documentId,
            documentName: documentNameMap[result.documentId] || undefined,
            content: result.content,
            chunkIndex: result.chunkIndex,
            metadata: tags,
            similarity: hasQuery ? 1 - result.distance : 1,
            ...(rerankerScore !== undefined && { rerankerScore }),
          }
        }),
        query: validatedData.query || '',
        knowledgeBaseIds: accessibleKbIds,
        knowledgeBaseId: accessibleKbIds[0],
        topK: validatedData.topK,
        totalResults: results.length,
        ...(cost
          ? {
              cost: {
                input: cost.input,
                output: cost.output,
                total: cost.total,
                tokens: {
                  prompt: tokenCount?.count ?? 0,
                  completion: 0,
                  total: tokenCount?.count ?? 0,
                },
                model: queryEmbeddingModel,
                pricing: cost.pricing,
                ...(rerankBilled && !rerankIsBYOK
                  ? { rerankerCost, rerankerModel, rerankerSearchUnits: 1 }
                  : {}),
              },
            }
          : {}),
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to perform vector search',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
})
