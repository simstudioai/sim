import { type NextRequest, NextResponse } from 'next/server'
import { v1KnowledgeSearchContract } from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
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
import { handleError } from '@/app/api/v1/knowledge/utils'
import { authenticateRequest, validateWorkspaceAccess } from '@/app/api/v1/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** POST /api/v1/knowledge/search — Vector search across knowledge bases. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await authenticateRequest(request, 'knowledge-search')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(v1KnowledgeSearchContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId, topK, query, tagFilters } = parsed.data.body

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

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
      return NextResponse.json(
        { error: 'Knowledge base not found or access denied' },
        { status: 404 }
      )
    }

    const inaccessibleKbIds = knowledgeBaseIds.filter((id) => !accessibleKbIds.includes(id))
    if (inaccessibleKbIds.length > 0) {
      return NextResponse.json(
        { error: `Knowledge bases not found or access denied: ${inaccessibleKbIds.join(', ')}` },
        { status: 404 }
      )
    }

    let structuredFilters: StructuredFilter[] = []
    const tagDefsCache = new Map<string, Awaited<ReturnType<typeof getDocumentTagDefinitions>>>()

    if (tagFilters && tagFilters.length > 0 && accessibleKbIds.length > 1) {
      return NextResponse.json(
        { error: 'Tag filters are only supported when searching a single knowledge base' },
        { status: 400 }
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
        return NextResponse.json({ error: errorParts.join('\n') }, { status: 400 })
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

    const hasQuery = query && query.trim().length > 0
    const hasFilters = structuredFilters.length > 0

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

    let results: SearchResult[]

    if (!hasQuery && hasFilters) {
      results = await handleTagOnlySearch({
        knowledgeBaseIds: accessibleKbIds,
        topK,
        structuredFilters,
      })
    } else if (hasQuery && hasFilters) {
      const strategy = getQueryStrategy(accessibleKbIds.length, topK)
      const queryVector = JSON.stringify(
        await generateSearchEmbedding(query!, queryEmbeddingModel, workspaceId)
      )
      results = await handleTagAndVectorSearch({
        knowledgeBaseIds: accessibleKbIds,
        topK,
        structuredFilters,
        queryVector,
        distanceThreshold: strategy.distanceThreshold,
      })
    } else if (hasQuery) {
      const strategy = getQueryStrategy(accessibleKbIds.length, topK)
      const queryVector = JSON.stringify(
        await generateSearchEmbedding(query!, queryEmbeddingModel, workspaceId)
      )
      results = await handleVectorOnlySearch({
        knowledgeBaseIds: accessibleKbIds,
        topK,
        queryVector,
        distanceThreshold: strategy.distanceThreshold,
      })
    } else {
      return NextResponse.json(
        { error: 'Either query or tagFilters must be provided' },
        { status: 400 }
      )
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

    return NextResponse.json({
      success: true,
      data: {
        results: results.map((result) => {
          const kbTagMap = tagDefinitionsMap[result.knowledgeBaseId] || {}
          const tags: Record<string, string | number | boolean | Date | null> = {}

          ALL_TAG_SLOTS.forEach((slot) => {
            const tagValue = result[slot as keyof SearchResult]
            if (tagValue !== null && tagValue !== undefined) {
              const displayName = kbTagMap[slot] || slot
              tags[displayName] = tagValue as string | number | boolean | Date | null
            }
          })

          const docMeta = documentMetadataMap[result.documentId]
          return {
            documentId: result.documentId,
            documentName: docMeta?.filename || undefined,
            sourceUrl: docMeta?.sourceUrl ?? null,
            content: result.content,
            chunkIndex: result.chunkIndex,
            metadata: tags,
            similarity: hasQuery ? 1 - result.distance : 1,
          }
        }),
        query: query || '',
        knowledgeBaseIds: accessibleKbIds,
        topK,
        totalResults: results.length,
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to perform search')
  }
})
