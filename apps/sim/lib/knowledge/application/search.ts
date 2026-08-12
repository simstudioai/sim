import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import {
  checkAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold,
} from '@/lib/billing/threshold-billing'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  KnowledgeUsageLimitExceededError,
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type KnowledgeResourceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
import { getEmbeddingModelInfo } from '@/lib/knowledge/embedding-models'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { rerank } from '@/lib/knowledge/reranker'
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
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { getRerankModelPricing } from '@/providers/models'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('KnowledgeSearchApplication')

export const KNOWLEDGE_SEARCH_COST_POLICY = {
  maxKnowledgeBases: 20,
  maxTopK: 100,
  usageAdmission: 'before_model_execution',
} as const

export class KnowledgeSearchProvenanceUnavailableError extends Error {
  constructor() {
    super('Knowledge result secret provenance is unavailable')
    this.name = 'KnowledgeSearchProvenanceUnavailableError'
  }
}

export interface KnowledgeSearchTagFilter {
  tagName: string
  fieldType?: 'text' | 'number' | 'date' | 'boolean'
  operator: string
  value: string | number | boolean
  valueTo?: string | number
}

export interface SearchKnowledgeInput {
  /** Optional assertion from a trusted adapter or public contract. */
  workspaceId?: string
  knowledgeBaseIds: string[]
  query?: string
  topK: number
  tagFilters?: KnowledgeSearchTagFilter[]
  searchMode?: 'vector' | 'hybrid'
  rerankerEnabled?: boolean
  rerankerModel?: string
  rerankerInputCount?: number
  rerankerApiKey?: string
  /** Honored only for an authenticated executor delegation. */
  skipUsageBilling?: boolean
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
  prepareModelInputProvenance?(input: {
    userId: string
    workspaceId?: string
  }): Promise<ResolvedSecretTraceRegistry | undefined>
  /** Trusted execution provenance sink; never sourced from an HTTP or model payload. */
  resultSecretRegistry?: ResolvedSecretTraceRegistry
}

type KnowledgeSearchContext = KnowledgeResourceContext & {
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
  rerankerScore?: number
}

interface KnowledgeSearchCost {
  input: number
  output: number
  total: number
  tokens: { prompt: number; completion: number; total: number }
  model: string
  pricing: { input: number; output: number; updatedAt?: string }
  rerankerCost?: number
  rerankerModel?: string
  rerankerSearchUnits?: number
}

export interface SearchKnowledgeResult {
  results: KnowledgeSearchItem[]
  query: string
  knowledgeBaseIds: string[]
  knowledgeBases: Array<{ id: string; name: string }>
  knowledgeBaseId: string
  topK: number
  totalResults: number
  cost?: KnowledgeSearchCost
  workspaceId?: string
  userId: string
  resultSecretRegistry?: ResolvedSecretTraceRegistry
}

async function resolveKnowledgeSearchContext(
  input: SearchKnowledgeInput
): Promise<KnowledgeSearchContext> {
  if (
    input.knowledgeBaseIds.length < 1 ||
    input.knowledgeBaseIds.length > KNOWLEDGE_SEARCH_COST_POLICY.maxKnowledgeBases
  ) {
    throw new OrchestrationError(
      'validation',
      `Knowledge search requires between 1 and ${KNOWLEDGE_SEARCH_COST_POLICY.maxKnowledgeBases} knowledge bases`
    )
  }
  if (
    !Number.isInteger(input.topK) ||
    input.topK < 1 ||
    input.topK > KNOWLEDGE_SEARCH_COST_POLICY.maxTopK
  ) {
    throw new OrchestrationError(
      'validation',
      `topK must be an integer between 1 and ${KNOWLEDGE_SEARCH_COST_POLICY.maxTopK}`
    )
  }
  const knowledgeBases = await Promise.all(input.knowledgeBaseIds.map(getKnowledgeBaseById))
  const missingIds = input.knowledgeBaseIds.filter((_, index) => !knowledgeBases[index])
  if (missingIds.length > 0) {
    throw new OrchestrationError(
      'not_found',
      `Knowledge bases not found or access denied: ${missingIds.join(', ')}`
    )
  }
  const canonicalWorkspaceIds = new Set(knowledgeBases.map((kb) => kb?.workspaceId ?? null))
  if (canonicalWorkspaceIds.size !== 1) {
    throw new OrchestrationError(
      'validation',
      'Selected knowledge bases must belong to the same workspace'
    )
  }
  const canonicalWorkspaceId = knowledgeBases[0]?.workspaceId ?? null
  if (input.workspaceId && input.workspaceId !== canonicalWorkspaceId) {
    throw new OrchestrationError(
      'not_found',
      `Knowledge bases not found or access denied: ${input.knowledgeBaseIds.join(', ')}`
    )
  }
  if (!canonicalWorkspaceId) {
    const ownerUserIds = new Set(knowledgeBases.map((knowledgeBase) => knowledgeBase?.userId))
    if (ownerUserIds.size !== 1) {
      throw new OrchestrationError(
        'not_found',
        `Knowledge bases not found or access denied: ${input.knowledgeBaseIds.join(', ')}`
      )
    }
    const legacyPersonalOwnerUserId = knowledgeBases[0]?.userId
    if (!legacyPersonalOwnerUserId) throw new Error('Legacy Knowledge base owner is missing')
    return {
      workspaceId: undefined,
      legacyPersonalOwnerUserId,
      knowledgeBases: knowledgeBases as KnowledgeBaseWithCounts[],
    }
  }
  const workspaceContext = await resolveKnowledgeWorkspaceContext({
    workspaceId: canonicalWorkspaceId,
  })
  return {
    ...workspaceContext,
    knowledgeBases: knowledgeBases as KnowledgeBaseWithCounts[],
  }
}

async function buildStructuredFilters(
  filters: KnowledgeSearchTagFilter[],
  knowledgeBaseIds: string[]
): Promise<{
  structuredFilters: StructuredFilter[]
  definitionsByKnowledgeBase: Map<string, Awaited<ReturnType<typeof getDocumentTagDefinitions>>>
}> {
  const definitionEntries = await Promise.all(
    knowledgeBaseIds.map(
      async (knowledgeBaseId) =>
        [knowledgeBaseId, await getDocumentTagDefinitions(knowledgeBaseId)] as const
    )
  )
  const definitionsByKnowledgeBase = new Map(definitionEntries)
  const sharedDefinitions = new Map<string, { tagSlot: string; fieldType: string }>()
  for (const [, definitions] of definitionEntries) {
    const currentByName = new Map(
      definitions.map((definition) => [
        definition.displayName,
        { tagSlot: definition.tagSlot, fieldType: definition.fieldType },
      ])
    )
    for (const filter of filters) {
      const current = currentByName.get(filter.tagName)
      if (!current) {
        if (knowledgeBaseIds.length > 1) {
          throw new OrchestrationError(
            'validation',
            `Tag "${filter.tagName}" does not exist in all selected knowledge bases. Search those knowledge bases separately.`
          )
        }
        continue
      }
      const existing = sharedDefinitions.get(filter.tagName)
      if (
        existing &&
        (existing.tagSlot !== current.tagSlot || existing.fieldType !== current.fieldType)
      ) {
        throw new OrchestrationError(
          'validation',
          `Tag "${filter.tagName}" is not mapped consistently across the selected knowledge bases. Search those knowledge bases separately.`
        )
      }
      sharedDefinitions.set(filter.tagName, current)
    }
  }
  const undefinedTags: string[] = []
  const typeErrors: string[] = []
  for (const filter of filters) {
    const definition = sharedDefinitions.get(filter.tagName)
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
    throw new OrchestrationError(
      'validation',
      [
        ...(undefinedTags.length > 0 ? [buildUndefinedTagsError(undefinedTags)] : []),
        ...typeErrors,
      ].join('\n')
    )
  }
  return {
    structuredFilters: filters.map((filter) => {
      const definition = sharedDefinitions.get(filter.tagName)
      if (!definition) throw new Error('Validated knowledge tag definition disappeared')
      return {
        tagSlot: definition.tagSlot,
        fieldType: definition.fieldType,
        operator: filter.operator,
        value: filter.value,
        valueTo: filter.valueTo,
      }
    }),
    definitionsByKnowledgeBase,
  }
}

export const searchKnowledge = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchKnowledgeInput }) =>
    resolveKnowledgeSearchContext(input),
  async execute({ principal, input, context }) {
    const requestId = generateRequestId()
    const hasQuery = Boolean(input.query?.trim())
    const filters = input.tagFilters ?? []
    if (!hasQuery && filters.length === 0) {
      throw new OrchestrationError(
        'validation',
        'Please provide either a search query or tag filters to search your knowledge base'
      )
    }
    const userId = resolveKnowledgeAttributedUserId(principal, context)
    const shouldMeter = !(
      input.skipUsageBilling &&
      principal.kind === 'delegated' &&
      principal.serviceId === 'executor'
    )
    const billingAttribution =
      hasQuery && context.workspaceId
        ? input.resolveBillingAttribution
          ? await input.resolveBillingAttribution(context.workspaceId)
          : await resolveKnowledgeBillingAttribution(principal, context)
        : undefined
    if (shouldMeter && hasQuery) {
      const usage = billingAttribution
        ? await checkAttributedUsageLimits(billingAttribution)
        : await checkActorUsageLimits(userId)
      if (usage.isExceeded) {
        throw new KnowledgeUsageLimitExceededError(
          usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
        )
      }
    }

    const knowledgeBaseIds = context.knowledgeBases.map((knowledgeBase) => knowledgeBase.id)
    let structuredFilters: StructuredFilter[] = []
    let definitionsByKnowledgeBase = new Map<
      string,
      Awaited<ReturnType<typeof getDocumentTagDefinitions>>
    >()
    if (filters.length > 0) {
      const built = await buildStructuredFilters(filters, knowledgeBaseIds)
      structuredFilters = built.structuredFilters
      definitionsByKnowledgeBase = built.definitionsByKnowledgeBase
    }

    const embeddingModels = [...new Set(context.knowledgeBases.map((kb) => kb.embeddingModel))]
    if (hasQuery && embeddingModels.length > 1) {
      throw new OrchestrationError(
        'validation',
        'Selected knowledge bases use different embedding models and cannot be searched together. Search them separately.'
      )
    }
    const embeddingModel = embeddingModels[0]
    const preparedRegistry = input.prepareModelInputProvenance
      ? await input.prepareModelInputProvenance({ userId, workspaceId: context.workspaceId })
      : undefined
    const resultSecretRegistry = preparedRegistry ?? input.resultSecretRegistry
    const queryEmbeddingPromise = hasQuery
      ? runWithKnowledgeModelInputProvenance(resultSecretRegistry, () =>
          generateSearchEmbedding(input.query!, embeddingModel, context.workspaceId)
        )
      : Promise.resolve(null)
    const useReranker = Boolean(input.rerankerEnabled && hasQuery)
    const candidateTopK = useReranker
      ? input.rerankerInputCount !== undefined
        ? Math.min(
            KNOWLEDGE_SEARCH_COST_POLICY.maxTopK,
            Math.max(input.topK, input.rerankerInputCount)
          )
        : Math.min(KNOWLEDGE_SEARCH_COST_POLICY.maxTopK, input.topK * 4)
      : input.topK
    let rows = await executeKnowledgeSearch({
      knowledgeBaseIds,
      topK: candidateTopK,
      searchMode: input.searchMode ?? 'vector',
      query: input.query,
      queryVector: hasQuery
        ? JSON.stringify((await queryEmbeddingPromise)?.embedding ?? null)
        : undefined,
      structuredFilters: structuredFilters.length > 0 ? structuredFilters : undefined,
    })

    const registry =
      resultSecretRegistry ??
      (input.prepareModelInputProvenance
        ? new ResolvedSecretTraceRegistry([], {
            userId,
            workspaceId: context.workspaceId,
          })
        : undefined)
    let provenanceSnapshot: Awaited<
      ReturnType<typeof importKnowledgeSearchResultSecretProvenance>
    > | null = null
    if (registry) {
      provenanceSnapshot = await importKnowledgeSearchResultSecretProvenance({
        registry,
        results: rows,
      })
      if (!provenanceSnapshot.imported) {
        registry.markIncomplete('knowledge-result-provenance-unavailable')
        if (useReranker) throw new KnowledgeSearchProvenanceUnavailableError()
      }
    }

    const rerankerScores = new Map<string, number>()
    let rerankerBilled = false
    let rerankerIsBYOK = false
    if (useReranker && input.rerankerModel && rows.length > 0) {
      const candidateCount = rows.length
      try {
        const reranked = await runWithKnowledgeModelInputProvenance(registry, () =>
          rerank(
            input.query!,
            rows.map((row) => ({ id: row.id, text: row.content })),
            {
              model: input.rerankerModel!,
              topN: input.topK,
              workspaceId: context.workspaceId,
              apiKey: input.rerankerApiKey,
            }
          )
        )
        rerankerBilled = true
        rerankerIsBYOK = reranked.isBYOK
        if (reranked.results.length === 0) {
          rows = rows.slice(0, input.topK)
        } else {
          const byId = new Map(rows.map((row) => [row.id, row]))
          rows = reranked.results
            .map((ranked) => byId.get(ranked.item.id))
            .filter((row): row is SearchResult => Boolean(row))
          for (const ranked of reranked.results) {
            rerankerScores.set(ranked.item.id, ranked.relevanceScore)
          }
        }
      } catch (error) {
        if (registry?.isPermanentlyIncomplete()) throw error
        logger.warn('Knowledge reranker failed; using vector ordering', {
          error: getErrorMessage(error),
          model: input.rerankerModel,
          candidateCount,
        })
        rows = rows.slice(0, input.topK)
      }
    } else if (useReranker) {
      rows = rows.slice(0, input.topK)
    }

    const queryEmbedding = await queryEmbeddingPromise
    let tokenCount = 0
    let baseCost: ReturnType<typeof calculateCost> | null = null
    if (hasQuery) {
      tokenCount = estimateTokenCount(
        input.query!,
        getEmbeddingModelInfo(embeddingModel).tokenizerProvider
      ).count
      if (!queryEmbedding?.isBYOK) baseCost = calculateCost(embeddingModel, tokenCount, 0, false)
    }
    let rerankerCost = 0
    if (rerankerBilled && input.rerankerModel && !rerankerIsBYOK) {
      const pricing = getRerankModelPricing(input.rerankerModel)
      if (pricing) {
        rerankerCost = pricing.perSearchUnit
        baseCost = baseCost
          ? {
              ...baseCost,
              input: baseCost.input + rerankerCost,
              total: baseCost.total + rerankerCost,
            }
          : {
              input: rerankerCost,
              output: 0,
              total: rerankerCost,
              pricing: { input: 0, output: 0, updatedAt: pricing.updatedAt },
            }
      }
    }
    if (shouldMeter && baseCost && baseCost.total > 0) {
      try {
        await recordUsage({
          userId,
          ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
          ...(billingAttribution ? toBillingContext(billingAttribution) : {}),
          entries: [
            {
              category: 'model',
              source: 'knowledge-base',
              description: embeddingModel,
              cost: baseCost.total,
              sourceReference: `kb-search:${requestId}`,
            },
          ],
        })
        if (billingAttribution) {
          await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
        } else {
          await checkAndBillOverageThreshold(userId)
        }
      } catch (error) {
        logger.error('Failed to record Knowledge search usage', { error })
      }
    }

    const tagDefinitionEntries = await Promise.all(
      knowledgeBaseIds.map(async (knowledgeBaseId) => {
        const definitions =
          definitionsByKnowledgeBase.get(knowledgeBaseId) ??
          (await getDocumentTagDefinitions(knowledgeBaseId))
        return [
          knowledgeBaseId,
          new Map(definitions.map((definition) => [definition.tagSlot, definition.displayName])),
        ] as const
      })
    )
    const tagMaps = new Map(tagDefinitionEntries)
    const basicDocumentMetadata = provenanceSnapshot
      ? {}
      : await getDocumentMetadataByIds(rows.map((row) => row.documentId))
    const results = rows.map((row): KnowledgeSearchItem => {
      const metadata: Record<string, unknown> = {}
      const tagMap = tagMaps.get(row.knowledgeBaseId)
      const provenanceDocument = provenanceSnapshot?.documentMetadata[row.documentId]
      const document = provenanceDocument ?? basicDocumentMetadata[row.documentId]
      for (const slot of ALL_TAG_SLOTS) {
        const value =
          provenanceDocument && slot.startsWith('tag')
            ? provenanceDocument[
                slot as 'tag1' | 'tag2' | 'tag3' | 'tag4' | 'tag5' | 'tag6' | 'tag7'
              ]
            : row[slot]
        if (value !== null && value !== undefined) metadata[tagMap?.get(slot) ?? slot] = value
      }
      const rerankerScore = rerankerScores.get(row.id)
      return {
        embeddingId: row.id,
        documentId: row.documentId,
        documentName: document?.filename ?? null,
        sourceUrl: document?.sourceUrl ?? null,
        content: row.content,
        chunkIndex: row.chunkIndex,
        metadata,
        similarity: hasQuery ? 1 - row.distance : 1,
        ...(rerankerScore !== undefined ? { rerankerScore } : {}),
      }
    })
    if (registry && provenanceSnapshot) {
      for (const [documentId, document] of Object.entries(provenanceSnapshot.documentMetadata)) {
        const renderedMetadata = results
          .filter((result) => result.documentId === documentId)
          .map((result) => ({
            documentName: result.documentName,
            sourceUrl: result.sourceUrl,
            metadata: result.metadata,
          }))
        if (
          renderedMetadata.length > 0 &&
          !(await importDurableSecretProvenance(
            registry,
            document.provenance,
            renderedMetadata,
            'knowledge'
          ))
        ) {
          registry.markIncomplete('knowledge-result-provenance-unavailable')
        }
      }
    }
    const cost = baseCost
      ? {
          input: baseCost.input,
          output: baseCost.output,
          total: baseCost.total,
          tokens: { prompt: tokenCount, completion: 0, total: tokenCount },
          model: embeddingModel,
          pricing: baseCost.pricing,
          ...(rerankerBilled && !rerankerIsBYOK
            ? {
                rerankerCost,
                rerankerModel: input.rerankerModel,
                rerankerSearchUnits: 1,
              }
            : {}),
        }
      : undefined
    return {
      results,
      query: input.query ?? '',
      knowledgeBaseIds,
      knowledgeBases: context.knowledgeBases.map((knowledgeBase) => ({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
      })),
      knowledgeBaseId: knowledgeBaseIds[0],
      topK: input.topK,
      totalResults: results.length,
      cost,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      userId,
      resultSecretRegistry: registry,
    }
  },
  afterSuccess: ({ context, result }) => {
    PlatformEvents.knowledgeBaseSearched({
      knowledgeBaseId: result.knowledgeBaseId,
      resultsCount: result.totalResults,
      workspaceId: context.workspaceId,
    })
  },
})
