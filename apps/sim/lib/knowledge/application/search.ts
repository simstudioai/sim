import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  KnowledgeUsageLimitExceededError,
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type KnowledgeWorkspaceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
import { recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import {
  executeKnowledgeSearch,
  generateSearchEmbedding,
  getDocumentMetadataByIds,
  type SearchResult,
} from '@/lib/knowledge/search/queries'
import { importKnowledgeSearchResultSecretProvenance } from '@/lib/knowledge/secret-provenance'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import { buildUndefinedTagsError, validateTagValue } from '@/lib/knowledge/tags/utils'
import type { KnowledgeBaseWithCounts, StructuredFilter } from '@/lib/knowledge/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface KnowledgeSearchTagFilter {
  tagName: string
  fieldType?: 'text' | 'number' | 'date' | 'boolean'
  operator: string
  value: string | number | boolean
  valueTo?: string | number
}

export interface SearchKnowledgeInput {
  workspaceId: string
  knowledgeBaseIds: string[]
  query?: string
  topK: number
  tagFilters?: KnowledgeSearchTagFilter[]
  /** Trusted execution provenance sink; never sourced from an HTTP or model payload. */
  resultSecretRegistry?: ResolvedSecretTraceRegistry
}

interface KnowledgeSearchContext extends KnowledgeWorkspaceContext {
  knowledgeBases: KnowledgeBaseWithCounts[]
}

export interface KnowledgeSearchItem {
  /** Trusted embedding identity for provenance import; HTTP presenters omit it. */
  embeddingId: string
  documentId: string
  documentName: string | null
  sourceUrl: string | null
  content: string
  chunkIndex: number
  metadata: Record<string, unknown>
  similarity: number
}

export interface SearchKnowledgeResult {
  results: KnowledgeSearchItem[]
  query: string
  knowledgeBaseIds: string[]
  topK: number
  totalResults: number
}

async function resolveKnowledgeSearchContext(
  input: SearchKnowledgeInput
): Promise<KnowledgeSearchContext> {
  if (input.knowledgeBaseIds.length < 1 || input.knowledgeBaseIds.length > 20) {
    throw new OrchestrationError(
      'validation',
      'Knowledge search requires between 1 and 20 knowledge bases'
    )
  }
  if (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > 100) {
    throw new OrchestrationError('validation', 'topK must be an integer between 1 and 100')
  }
  const workspaceContext = await resolveKnowledgeWorkspaceContext(input)
  const knowledgeBases = await Promise.all(input.knowledgeBaseIds.map(getKnowledgeBaseById))
  const inaccessibleIds = input.knowledgeBaseIds.filter(
    (_id, index) => knowledgeBases[index]?.workspaceId !== workspaceContext.workspaceId
  )
  if (inaccessibleIds.length > 0) {
    throw new OrchestrationError(
      'not_found',
      `Knowledge bases not found or access denied: ${inaccessibleIds.join(', ')}`
    )
  }
  return {
    ...workspaceContext,
    knowledgeBases: knowledgeBases as KnowledgeBaseWithCounts[],
  }
}

function buildStructuredFilters(
  filters: KnowledgeSearchTagFilter[],
  tagDefinitions: Awaited<ReturnType<typeof getDocumentTagDefinitions>>
): StructuredFilter[] {
  const definitionsByName = new Map(
    tagDefinitions.map((definition) => [definition.displayName, definition])
  )
  const undefinedTags: string[] = []
  const typeErrors: string[] = []
  for (const filter of filters) {
    const definition = definitionsByName.get(filter.tagName)
    if (!definition) {
      undefinedTags.push(filter.tagName)
      continue
    }
    const validationError = validateTagValue(
      filter.tagName,
      String(filter.value),
      definition.fieldType
    )
    if (validationError) typeErrors.push(validationError)
  }
  if (undefinedTags.length > 0 || typeErrors.length > 0) {
    const messages = [
      ...(undefinedTags.length > 0 ? [buildUndefinedTagsError(undefinedTags)] : []),
      ...typeErrors,
    ]
    throw new OrchestrationError('validation', messages.join('\n'))
  }
  return filters.map((filter) => {
    const definition = definitionsByName.get(filter.tagName)
    if (!definition) throw new Error('Validated knowledge tag definition disappeared')
    return {
      tagSlot: definition.tagSlot,
      fieldType: definition.fieldType,
      operator: filter.operator,
      value: filter.value,
      valueTo: filter.valueTo,
    }
  })
}

export const searchKnowledge = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchKnowledgeInput }) =>
    resolveKnowledgeSearchContext(input),
  async execute({ principal, input, context }) {
    const hasQuery = Boolean(input.query?.trim())
    const filters = input.tagFilters ?? []
    if (!hasQuery && filters.length === 0) {
      throw new OrchestrationError('validation', 'Either query or tagFilters must be provided')
    }
    if (filters.length > 0 && context.knowledgeBases.length > 1) {
      throw new OrchestrationError(
        'validation',
        'Tag filters are only supported when searching a single knowledge base'
      )
    }

    const billingAttribution = hasQuery
      ? await resolveKnowledgeBillingAttribution(principal, context)
      : undefined
    if (billingAttribution) {
      const usage = await checkAttributedUsageLimits(billingAttribution)
      if (usage.isExceeded) {
        throw new KnowledgeUsageLimitExceededError(
          usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
        )
      }
    }

    const tagDefinitionsByKnowledgeBase = new Map<
      string,
      Awaited<ReturnType<typeof getDocumentTagDefinitions>>
    >()
    let structuredFilters: StructuredFilter[] = []
    if (filters.length > 0) {
      const knowledgeBaseId = context.knowledgeBases[0].id
      const definitions = await getDocumentTagDefinitions(knowledgeBaseId)
      tagDefinitionsByKnowledgeBase.set(knowledgeBaseId, definitions)
      structuredFilters = buildStructuredFilters(filters, definitions)
    }

    const embeddingModels = [...new Set(context.knowledgeBases.map((kb) => kb.embeddingModel))]
    if (hasQuery && embeddingModels.length > 1) {
      throw new OrchestrationError(
        'validation',
        'Selected knowledge bases use different embedding models and cannot be searched together. Search them separately.'
      )
    }
    const embeddingModel = embeddingModels[0]
    let queryEmbeddingIsBYOK: boolean | null = null
    let queryVector: string | undefined
    if (hasQuery) {
      const generated = await generateSearchEmbedding(
        input.query!,
        embeddingModel,
        context.workspaceId
      )
      queryEmbeddingIsBYOK = generated.isBYOK
      queryVector = JSON.stringify(generated.embedding)
    }

    const knowledgeBaseIds = context.knowledgeBases.map((kb) => kb.id)
    const rows = await executeKnowledgeSearch({
      knowledgeBaseIds,
      topK: input.topK,
      searchMode: 'vector',
      query: input.query,
      queryVector,
      structuredFilters,
    })

    if (input.resultSecretRegistry) {
      const provenance = await importKnowledgeSearchResultSecretProvenance({
        registry: input.resultSecretRegistry,
        results: rows,
      })
      if (!provenance.imported) {
        input.resultSecretRegistry.markIncomplete()
        throw new Error('Knowledge result secret provenance is unavailable')
      }
    }

    if (queryEmbeddingIsBYOK !== null && billingAttribution) {
      await recordSearchEmbeddingUsage({
        userId: resolveKnowledgeAttributedUserId(principal, context),
        workspaceId: context.workspaceId,
        embeddingModel,
        query: input.query!,
        isBYOK: queryEmbeddingIsBYOK,
        sourceReference: `v2-kb-search:${generateRequestId()}`,
        billingAttribution,
      })
    }

    const tagDefinitionEntries = await Promise.all(
      knowledgeBaseIds.map(async (knowledgeBaseId) => {
        const definitions =
          tagDefinitionsByKnowledgeBase.get(knowledgeBaseId) ??
          (await getDocumentTagDefinitions(knowledgeBaseId))
        return [
          knowledgeBaseId,
          new Map(definitions.map((definition) => [definition.tagSlot, definition.displayName])),
        ] as const
      })
    )
    const tagMaps = new Map(tagDefinitionEntries)
    const documentMetadata = await getDocumentMetadataByIds(rows.map((row) => row.documentId))

    const results = rows.map((row: SearchResult): KnowledgeSearchItem => {
      const metadata: Record<string, unknown> = {}
      const tagMap = tagMaps.get(row.knowledgeBaseId)
      for (const slot of ALL_TAG_SLOTS) {
        const value = row[slot]
        if (value !== null && value !== undefined) metadata[tagMap?.get(slot) ?? slot] = value
      }
      const document = documentMetadata[row.documentId]
      return {
        embeddingId: row.id,
        documentId: row.documentId,
        documentName: document?.filename ?? null,
        sourceUrl: document?.sourceUrl ?? null,
        content: row.content,
        chunkIndex: row.chunkIndex,
        metadata,
        similarity: hasQuery ? 1 - row.distance : 1,
      }
    })
    return {
      results,
      query: input.query ?? '',
      knowledgeBaseIds,
      topK: input.topK,
      totalResults: results.length,
    }
  },
})
