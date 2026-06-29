import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  type V2KnowledgeSearchResult,
  v2SearchKnowledgeContract,
} from '@/lib/api/contracts/v2/knowledge'
import { isZodError, parseRequest } from '@/lib/api/server'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
import { recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { buildUndefinedTagsError, validateTagValue } from '@/lib/knowledge/tags/utils'
import type { StructuredFilter } from '@/lib/knowledge/types'
import {
  generateSearchEmbedding,
  getDocumentMetadataByIds,
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type SearchResult,
} from '@/app/api/knowledge/search/utils'
import { checkKnowledgeBaseAccess, type KnowledgeBaseAccessResult } from '@/app/api/knowledge/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2KnowledgeSearchAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** POST /api/v2/knowledge/search — Vector / tag search across knowledge bases. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'knowledge-search')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2SearchKnowledgeContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, topK, query, tagFilters } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    // A query incurs hosted embedding (+ optional rerank) cost — gate the actor's
    // usage and frozen status before spending. Tag-only search is free, so skip it.
    if (query && query.trim().length > 0) {
      const usage = await checkActorUsageLimits(userId, workspaceId)
      if (usage.isExceeded) {
        return v2Error(
          'USAGE_LIMIT_EXCEEDED',
          usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
        )
      }
    }

    const knowledgeBaseIds = Array.isArray(parsed.data.body.knowledgeBaseIds)
      ? parsed.data.body.knowledgeBaseIds
      : [parsed.data.body.knowledgeBaseIds]

    const accessChecks = await Promise.all(
      knowledgeBaseIds.map((kbId) => checkKnowledgeBaseAccess(kbId, userId))
    )
    const accessibleKbs = accessChecks
      .filter(
        (ac): ac is KnowledgeBaseAccessResult =>
          ac.hasAccess === true && ac.knowledgeBase.workspaceId === workspaceId
      )
      .map((ac) => ac.knowledgeBase)
    const accessibleKbIds = accessibleKbs.map((kb) => kb.id)

    if (accessibleKbIds.length === 0) {
      return v2Error('NOT_FOUND', 'Knowledge base not found or access denied')
    }

    const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))
    if (inaccessibleKbIds.length > 0) {
      return v2Error(
        'NOT_FOUND',
        `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}`
      )
    }

    let structuredFilters: StructuredFilter[] = []
    const tagDefsCache = new Map<string, Awaited<ReturnType<typeof getDocumentTagDefinitions>>>()

    if (tagFilters && tagFilters.length > 0 && accessibleKbIds.length > 1) {
      return v2Error(
        'BAD_REQUEST',
        'Tag filters are only supported when searching a single knowledge base'
      )
    }

    if (tagFilters && tagFilters.length > 0 && accessibleKbIds.length > 0) {
      const kbId = accessibleKbIds[0]
      const tagDefs = await getDocumentTagDefinitions(kbId)
      tagDefsCache.set(kbId, tagDefs)

      const displayNameToTagDef: Record<string, { tagSlot: string; fieldType: string }> = {}
      tagDefs.forEach((def) => {
        displayNameToTagDef[def.displayName] = {
          tagSlot: def.tagSlot,
          fieldType: def.fieldType,
        }
      })

      const undefinedTags: string[] = []
      const typeErrors: string[] = []

      for (const filter of tagFilters) {
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
        return v2Error('BAD_REQUEST', errorParts.join('\n'))
      }

      structuredFilters = tagFilters.map((filter) => {
        const tagDef = displayNameToTagDef[filter.tagName]!
        return {
          tagSlot: tagDef.tagSlot,
          fieldType: tagDef.fieldType,
          operator: filter.operator,
          value: filter.value,
          valueTo: filter.valueTo,
        }
      })
    }

    const hasQuery = Boolean(query && query.trim().length > 0)
    const hasFilters = structuredFilters.length > 0

    const embeddingModels = Array.from(new Set(accessibleKbs.map((kb) => kb.embeddingModel)))
    if (hasQuery && embeddingModels.length > 1) {
      return v2Error(
        'BAD_REQUEST',
        'Selected knowledge bases use different embedding models and cannot be searched together. Search them separately.'
      )
    }
    const queryEmbeddingModel = embeddingModels[0]

    let results: SearchResult[]
    let queryEmbeddingIsBYOK: boolean | null = null

    if (!hasQuery && hasFilters) {
      results = await handleTagOnlySearch({
        knowledgeBaseIds: accessibleKbIds,
        topK,
        structuredFilters,
      })
    } else if (hasQuery && hasFilters) {
      const strategy = getQueryStrategy(accessibleKbIds.length, topK)
      const queryEmbeddingResult = await generateSearchEmbedding(
        query!,
        queryEmbeddingModel,
        workspaceId
      )
      queryEmbeddingIsBYOK = queryEmbeddingResult.isBYOK
      const queryVector = JSON.stringify(queryEmbeddingResult.embedding)
      results = await handleTagAndVectorSearch({
        knowledgeBaseIds: accessibleKbIds,
        topK,
        structuredFilters,
        queryVector,
        distanceThreshold: strategy.distanceThreshold,
      })
    } else if (hasQuery) {
      const strategy = getQueryStrategy(accessibleKbIds.length, topK)
      const queryEmbeddingResult = await generateSearchEmbedding(
        query!,
        queryEmbeddingModel,
        workspaceId
      )
      queryEmbeddingIsBYOK = queryEmbeddingResult.isBYOK
      const queryVector = JSON.stringify(queryEmbeddingResult.embedding)
      results = await handleVectorOnlySearch({
        knowledgeBaseIds: accessibleKbIds,
        topK,
        queryVector,
        distanceThreshold: strategy.distanceThreshold,
      })
    } else {
      return v2Error('BAD_REQUEST', 'Either query or tagFilters must be provided')
    }

    if (queryEmbeddingIsBYOK !== null) {
      await recordSearchEmbeddingUsage({
        userId,
        workspaceId,
        embeddingModel: queryEmbeddingModel,
        query: query!,
        isBYOK: queryEmbeddingIsBYOK,
        sourceReference: `v2-kb-search:${requestId}`,
      })
    }

    const tagDefsResults = await Promise.all(
      accessibleKbIds.map(async (kbId) => {
        try {
          const tagDefs = tagDefsCache.get(kbId) ?? (await getDocumentTagDefinitions(kbId))
          const map: Record<string, string> = {}
          tagDefs.forEach((def) => {
            map[def.tagSlot] = def.displayName
          })
          return { kbId, map }
        } catch {
          return { kbId, map: {} as Record<string, string> }
        }
      })
    )
    const tagDefinitionsMap: Record<string, Record<string, string>> = {}
    tagDefsResults.forEach(({ kbId, map }) => {
      tagDefinitionsMap[kbId] = map
    })

    const documentIds = results.map((r) => r.documentId)
    const documentMetadataMap = await getDocumentMetadataByIds(documentIds)

    const searchResults: V2KnowledgeSearchResult[] = results.map((result) => {
      const kbTagMap = tagDefinitionsMap[result.knowledgeBaseId] || {}
      const metadata: Record<string, unknown> = {}

      ALL_TAG_SLOTS.forEach((slot) => {
        const tagValue = result[slot as keyof SearchResult]
        if (tagValue !== null && tagValue !== undefined) {
          const displayName = kbTagMap[slot] || slot
          metadata[displayName] = tagValue
        }
      })

      const docMeta = documentMetadataMap[result.documentId]
      return {
        documentId: result.documentId,
        documentName: docMeta?.filename ?? null,
        sourceUrl: docMeta?.sourceUrl ?? null,
        content: result.content,
        chunkIndex: result.chunkIndex,
        metadata,
        similarity: hasQuery ? 1 - result.distance : 1,
      }
    })

    return v2Data(
      {
        results: searchResults,
        query: query || '',
        knowledgeBaseIds: accessibleKbIds,
        topK,
        totalResults: results.length,
      },
      { rateLimit }
    )
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)
    logger.error(`[${requestId}] Knowledge search error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
