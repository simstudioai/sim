import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type BillingAttributionSnapshot,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { checkSearchUsageLimits } from '@/lib/billing/core/usage-gate-cache'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeFromOwner, resourceScopeKey } from '@/lib/core/resource-scope'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import { reportDurableSecretProvenanceRefusal } from '@/lib/execution/durable-secret-provenance-telemetry'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import type { KnowledgeAccessProvider } from '@/lib/knowledge/access/types'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  KnowledgeUsageLimitExceededError,
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type KnowledgeResourceContext,
  resolveKnowledgeOrganizationContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { instrumentSearchUseCase } from '@/lib/knowledge/application/search-diagnostics'
import { ALL_TAG_SLOTS } from '@/lib/knowledge/constants'
import { getEmbeddingModelInfo, toKbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import { generateSearchEmbedding, type KbEmbeddingTarget } from '@/lib/knowledge/embeddings'
import type { ActiveKnowledgeBaseReference } from '@/lib/knowledge/knowledge-base-reference'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { hasRerankerCredential, rerank } from '@/lib/knowledge/reranker'
import type { RerankerStatus } from '@/lib/knowledge/reranker-models'
import { recordOrganizationSearchActivity } from '@/lib/knowledge/search/activity'
import { SearchDeadlineError } from '@/lib/knowledge/search/budget'
import { resolveKnowledgeSearchDefaults } from '@/lib/knowledge/search/defaults'
import { annotateSearchDiagnostics, measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import {
  type RetrievalStatus,
  retrieveKnowledgeSearch,
  type SearchResult,
} from '@/lib/knowledge/search/queries'
import { importKnowledgeSearchResultSecretProvenance } from '@/lib/knowledge/secret-provenance'
import { getActiveKnowledgeBaseReferences } from '@/lib/knowledge/service'
import {
  type KnowledgeTagNameFilter,
  resolveKnowledgeTagFilters,
} from '@/lib/knowledge/tags/filter-resolution'
import { getDocumentTagDefinitionsByKnowledgeBaseIds } from '@/lib/knowledge/tags/service'
import type { DocumentTagDefinition } from '@/lib/knowledge/tags/types'
import type { StructuredFilter } from '@/lib/knowledge/types'
import { assertSearchIndexesActive } from '@/lib/sim-search/indexed/gate'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { getRerankModelPricing } from '@/providers/models'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('KnowledgeSearchApplication')

export const KNOWLEDGE_SEARCH_COST_POLICY = {
  maxKnowledgeBases: 20,
  maxTopK: 100,
} as const

export class KnowledgeSearchProvenanceUnavailableError extends Error {
  constructor() {
    super('Knowledge result secret provenance is unavailable')
    this.name = 'KnowledgeSearchProvenanceUnavailableError'
  }
}

/**
 * Search filters tags by display name. The resolution to storage slots is
 * shared with the document list so both knowledge reads speak one vocabulary.
 */
export type KnowledgeSearchTagFilter = KnowledgeTagNameFilter

export interface SearchKnowledgeInput {
  /** Allows returning available results when a retrieval leg times out. */
  allowPartialResults?: boolean
  /** Trusted adapter's vector retrieval budget; omitted callers use the shared default. */
  vectorBudgetMs?: number
  /** Optional assertion from a trusted adapter or public contract. */
  workspaceId?: string
  organizationId?: string
  knowledgeBaseIds: string[]
  query?: string
  topK: number
  tagFilters?: KnowledgeSearchTagFilter[]
  filters?: WorkspaceSearchFilters
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
  /** Trusted adapter identity for telemetry; never accepted from a model or HTTP body. */
  surface?: 'dashboard' | 'mcp' | 'copilot' | 'workflow' | 'api' | 'slack'
  /** Cancellation from the trusted transport or executor, never a serialized request field. */
  signal?: AbortSignal
}

type KnowledgeSearchContext = KnowledgeResourceContext & {
  knowledgeBases: ActiveKnowledgeBaseReference[]
  /** What the caller may read across the searched bases; resolved from the principal, never from input. */
  access: KnowledgeAccessProvider
}

export interface KnowledgeSearchItem {
  /** Trusted embedding identity for provenance import; HTTP presenters omit it. */
  embeddingId: string
  /** Knowledge base the matching chunk came from; a search spans up to 20. */
  knowledgeBaseId: string
  documentId: string
  documentName: string | null
  sourceUrl: string | null
  /** When the source last changed the document; null for uploads and sources that do not say. */
  sourceModifiedAt: Date | null
  /** The connector the document was synced through; null for an upload. */
  connectorType: string | null
  content: string
  chunkIndex: number
  metadata: Record<string, unknown>
  /** Cosine similarity to the query in every mode (1 for tag-only matches); not the ordering key in hybrid mode. */
  similarity: number
  /**
   * Reranker score when reranked; otherwise the retrieval score (reciprocal-rank
   * fusion in hybrid mode, cosine similarity in vector mode). Recency boosting
   * may reorder retrieval results; `rank` always reflects the returned order.
   */
  rankScore: number
  /** 1-based position in the returned order. */
  rank: number
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
  retrieval: RetrievalStatus
  results: KnowledgeSearchItem[]
  query: string
  knowledgeBaseIds: string[]
  knowledgeBases: Array<{ id: string; name: string }>
  knowledgeBaseId: string
  topK: number
  totalResults: number
  rerankerStatus: RerankerStatus
  cost?: KnowledgeSearchCost
  workspaceId?: string
  userId: string
  /** Whether results were filtered as a person or as the workspace; telemetry only, never presented. */
  accessScopeKind: 'user' | 'workspace'
  resultSecretRegistry?: ResolvedSecretTraceRegistry
}

/** The request's shape, checked before anything is read for it. */
export function validateKnowledgeSearchInput(input: SearchKnowledgeInput): void {
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
}

/**
 * The search context over bases already resolved and authorized under `context`: what the
 * caller may read across them comes from the principal, never from the input.
 */
export function buildKnowledgeSearchContext(
  principal: Principal,
  context: KnowledgeResourceContext,
  knowledgeBases: ActiveKnowledgeBaseReference[],
  input: Pick<SearchKnowledgeInput, 'signal'>
): KnowledgeSearchContext {
  const knowledgeBaseIds = knowledgeBases.map((base) => base.id)
  const signal = input.signal
  return {
    ...context,
    knowledgeBases,
    access: createKnowledgeAccessProvider(
      principal,
      context.organizationId
        ? { ...context, knowledgeBaseIds, signal }
        : { workspaceId: context.workspaceId, knowledgeBaseIds, signal }
    ),
  }
}

async function resolveKnowledgeSearchContext(
  input: SearchKnowledgeInput,
  principal: Principal
): Promise<KnowledgeSearchContext> {
  validateKnowledgeSearchInput(input)
  const knowledgeBases = await getActiveKnowledgeBaseReferences(input.knowledgeBaseIds)
  const missingIds = input.knowledgeBaseIds.filter((_, index) => {
    const knowledgeBase = knowledgeBases[index]
    return !knowledgeBase || (!knowledgeBase.workspaceId && !knowledgeBase.organizationId)
  })
  if (missingIds.length > 0) {
    throw new OrchestrationError(
      'not_found',
      `Knowledge bases not found or access denied: ${missingIds.join(', ')}`
    )
  }
  const canonicalWorkspaceIds = new Set(
    knowledgeBases.map((kb) => resourceScopeKey(resourceScopeFromOwner(kb!)))
  )
  if (canonicalWorkspaceIds.size !== 1) {
    throw new OrchestrationError(
      'validation',
      'Selected knowledge bases must belong to the same workspace'
    )
  }
  const canonicalWorkspaceId = knowledgeBases[0]?.workspaceId ?? null
  const canonicalOrganizationId = knowledgeBases[0]?.organizationId
  if (
    (input.organizationId && input.organizationId !== canonicalOrganizationId) ||
    (input.workspaceId && input.workspaceId !== canonicalWorkspaceId)
  ) {
    throw new OrchestrationError(
      'not_found',
      `Knowledge bases not found or access denied: ${input.knowledgeBaseIds.join(', ')}`
    )
  }
  const resolved = knowledgeBases as ActiveKnowledgeBaseReference[]
  if (canonicalOrganizationId) {
    const context = await resolveKnowledgeOrganizationContext({
      organizationId: canonicalOrganizationId,
    })
    return buildKnowledgeSearchContext(principal, context, resolved, input)
  }
  if (!canonicalWorkspaceId) {
    throw new OrchestrationError('not_found', 'Knowledge base not found')
  }
  const workspaceContext = await resolveKnowledgeWorkspaceContext({
    workspaceId: canonicalWorkspaceId,
  })
  return buildKnowledgeSearchContext(principal, workspaceContext, resolved, input)
}

export interface KnowledgeSearchExecution {
  principal: Principal
  input: SearchKnowledgeInput
  context: KnowledgeSearchContext
}

/**
 * The search itself, over a context its caller has already resolved and authorized: the
 * operation each search surface shares once it has decided which bases the request may read.
 */
export async function runKnowledgeSearch({
  principal,
  input,
  context,
}: KnowledgeSearchExecution): Promise<SearchKnowledgeResult> {
  annotateSearchDiagnostics({
    scopeKind: context.organizationId ? 'organization' : 'workspace',
    knowledgeBaseCount: context.knowledgeBases.length,
  })
  /** A search index is readable only while indexed organization search is on; nothing is spent first. */
  assertSearchIndexesActive(context.knowledgeBases)
  input.signal?.throwIfAborted()
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
  /**
   * Whether the organization may search at all, and whether this payer still may: neither
   * depends on the query, so both run beside the scope and defaults reads below instead of
   * ahead of them. Admission stays ahead of the embedding call, which a refused search must
   * never make.
   */
  const admit = async (): Promise<BillingAttributionSnapshot | undefined> => {
    if (context.organizationId)
      await measureSearchStage('availability', () =>
        requireOrganizationSearchAvailable(context.organizationId!)
      )
    const billingAttribution = hasQuery
      ? input.resolveBillingAttribution && context.workspaceId
        ? await measureSearchStage('billing_attribution', () =>
            input.resolveBillingAttribution!(context.workspaceId!)
          )
        : await measureSearchStage('billing_attribution', () =>
            resolveKnowledgeBillingAttribution(principal, context)
          )
      : undefined
    if (shouldMeter && billingAttribution) {
      const usage = await measureSearchStage('usage_admission', () =>
        checkSearchUsageLimits(billingAttribution)
      )
      if (usage.isExceeded) {
        throw new KnowledgeUsageLimitExceededError(
          usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
        )
      }
    }
    return billingAttribution
  }

  const knowledgeBaseIds = context.knowledgeBases.map((knowledgeBase) => knowledgeBase.id)
  let structuredFilters: StructuredFilter[] = []
  let definitionsByKnowledgeBase = new Map<string, DocumentTagDefinition[]>()
  if (filters.length > 0) {
    const built = await measureSearchStage('tag_filters', () =>
      resolveKnowledgeTagFilters(filters, knowledgeBaseIds)
    )
    structuredFilters = built.structuredFilters
    definitionsByKnowledgeBase = built.definitionsByKnowledgeBase
  }

  /**
   * One query embedding serves every leg, so every base in the request has to
   * be indexed the same way. The width is part of that: it selects the
   * pgvector column each comparison reads, and two bases on the same model at
   * different widths still live in different columns.
   *
   * Built only for a query search. A tag-only request never embeds anything,
   * so resolving a width it will not use would let one base recorded at an
   * unstorable width fail a request that does not depend on it.
   */
  const embeddingTargets = new Map(
    context.knowledgeBases.map((kb) => [
      `${kb.embeddingModel}:${kb.embeddingDimension}`,
      { model: kb.embeddingModel, dimensions: kb.embeddingDimension },
    ])
  )
  if (hasQuery && embeddingTargets.size > 1) {
    throw new OrchestrationError(
      'validation',
      'Selected knowledge bases use different embedding models or vector widths and cannot be searched together. Search them separately.'
    )
  }
  const selectedTarget = [...embeddingTargets.values()][0]
  const embeddingModel = selectedTarget.model
  /**
   * The width is narrowed to a storable one only for a query search, which is
   * the only kind that reads a vector column. A tag-only search must not fail
   * on a width it never uses.
   */
  const embeddingTarget: KbEmbeddingTarget | undefined = hasQuery
    ? {
        model: selectedTarget.model,
        dimensions: toKbEmbeddingDimensions(selectedTarget.dimensions),
      }
    : undefined
  input.signal?.throwIfAborted()
  const [
    access,
    searchDefaults,
    billingAttribution,
    tagDefinitions,
    rerankerCredential,
    preparedRegistry,
  ] = await Promise.all([
    measureSearchStage('access_scope', () => context.access.get()),
    measureSearchStage('defaults', () =>
      resolveKnowledgeSearchDefaults({
        workspaceId: context.workspaceId,
        organizationId: context.organizationId,

        /** The signed-in person, if any; never the billing owner or a key's creator. */
        userId: resolvePrincipalSubjectUserId(principal) ?? undefined,
        requestedMode: input.searchMode,
      })
    ),
    admit(),
    /** The tag names the results are labelled with depend on the bases alone. */
    filters.length === 0
      ? measureSearchStage('tag_definitions', () =>
          getDocumentTagDefinitionsByKnowledgeBaseIds(knowledgeBaseIds)
        )
      : Promise.resolve(definitionsByKnowledgeBase),
    /** A surface may ask to rerank; without a key for the workspace or the platform there is nothing to ask. */
    input.rerankerEnabled && hasQuery
      ? hasRerankerCredential(context.workspaceId, input.rerankerApiKey)
      : false,
    input.prepareModelInputProvenance
      ? measureSearchStage('input_provenance', () =>
          input.prepareModelInputProvenance!({ userId, workspaceId: context.workspaceId })
        )
      : undefined,
  ])
  const resultSecretRegistry = preparedRegistry ?? input.resultSecretRegistry
  definitionsByKnowledgeBase = tagDefinitions
  input.signal?.throwIfAborted()
  /** Requested only once every prerequisite held: a search refused for any reason spends no model call. */
  const queryEmbedding = hasQuery
    ? await measureSearchStage('embedding', () =>
        runWithKnowledgeModelInputProvenance(resultSecretRegistry, () =>
          generateSearchEmbedding(input.query!, embeddingTarget!, context.workspaceId, input.signal)
        )
      )
    : null
  input.signal?.throwIfAborted()
  annotateSearchDiagnostics({
    accessScopeKind: access.kind,
    searchMode: searchDefaults.searchMode,
    boostRecency: searchDefaults.boostRecency,
    embeddingDimensions: embeddingTarget?.dimensions,
  })
  const useReranker = rerankerCredential
  const candidateTopK = useReranker
    ? input.rerankerInputCount !== undefined
      ? Math.min(
          KNOWLEDGE_SEARCH_COST_POLICY.maxTopK,
          Math.max(input.topK, input.rerankerInputCount)
        )
      : Math.min(KNOWLEDGE_SEARCH_COST_POLICY.maxTopK, input.topK * 4)
    : input.topK
  const retrieved = await measureSearchStage('retrieval', () =>
    retrieveKnowledgeSearch({
      vectorBudgetMs: input.vectorBudgetMs,
      knowledgeBaseIds,
      topK: candidateTopK,
      filters: input.filters,
      access,
      accessProvider: context.access,
      signal: input.signal,
      searchMode: searchDefaults.searchMode,
      boostRecency: searchDefaults.boostRecency,
      query: input.query,
      queryVector: hasQuery
        ? {
            vector: JSON.stringify(queryEmbedding?.embedding ?? null),
            dimensions: embeddingTarget!.dimensions,
            model: embeddingTarget!.model,
          }
        : undefined,
      structuredFilters: structuredFilters.length > 0 ? structuredFilters : undefined,
      searchIndexOnly: context.knowledgeBases.every((knowledgeBase) => knowledgeBase.isSearchIndex),
    })
  )

  annotateSearchDiagnostics({
    retrievalStatus: retrieved.retrieval.status,
    timedOutLegs: retrieved.retrieval.timedOutLegs,
  })
  if (retrieved.retrieval.status === 'partial' && !input.allowPartialResults)
    throw new SearchDeadlineError()
  let rows = retrieved.rows
  input.signal?.throwIfAborted()
  /** Public callers have no input envelope, but persisted reranker inputs still need provenance. */
  const registrySubjectUserId = resolvePrincipalSubjectUserId(principal)
  const registry =
    resultSecretRegistry ??
    (input.prepareModelInputProvenance || useReranker
      ? new ResolvedSecretTraceRegistry(
          [],
          registrySubjectUserId
            ? { userId: registrySubjectUserId, workspaceId: context.workspaceId }
            : undefined
        )
      : undefined)
  let provenanceSnapshot: Awaited<
    ReturnType<typeof importKnowledgeSearchResultSecretProvenance>
  > | null = null
  if (registry) {
    provenanceSnapshot = await measureSearchStage('result_provenance', () =>
      importKnowledgeSearchResultSecretProvenance({
        registry,
        results: rows,
      })
    )
    if (!provenanceSnapshot.imported) {
      registry.markIncomplete('knowledge-result-provenance-unavailable')
      if (useReranker) {
        reportDurableSecretProvenanceRefusal({
          surface: 'knowledge',
          cause: 'knowledge-result-provenance-unavailable',
          workspaceId: context.workspaceId,
        })
        throw new KnowledgeSearchProvenanceUnavailableError()
      }
    }
  }

  const rerankerScores = new Map<string, number>()
  let rerankerBilled = false
  let rerankerIsBYOK = false
  /**
   * Returned on every search. The fallback to vector ordering is deliberate — a
   * Cohere outage should not take knowledge search down with it — but until this
   * was reported the fallback was also invisible: a 200 whose results were
   * byte-identical to an unreranked search, with no `rerankerScore` anywhere and
   * nothing to say why.
   *
   * It starts at the outcome that holds if the rerank call below never happens or
   * never completes, so only the success path has to move it. A request with
   * nothing to rank — no query text, or no candidate rows — is `skipped` rather
   * than `unavailable`: the reranker was never the obstacle. Anything else that
   * was asked for and did not produce a usable ordering is `unavailable`,
   * including a request that reaches here with no model, which no HTTP contract
   * can now produce.
   *
   * A call that returns without raising but hands back an empty ordering counts
   * as `unavailable` too, and it is not the reranker "matching nothing":
   * `rerank` asks for `top_n` over a non-empty document list, so a provider that
   * ranked them returns one entry per document. Empty means the response carried
   * nothing usable — no results, or only indices outside the batch, which
   * `rerank` drops. The caller is left in vector order with no `rerankerScore`,
   * which is exactly what `unavailable` promises, and retrying is exactly the
   * right advice.
   */
  let rerankerStatus: RerankerStatus = !input.rerankerEnabled
    ? 'not_requested'
    : !hasQuery || rows.length === 0
      ? 'skipped'
      : 'unavailable'
  if (useReranker && input.rerankerModel && rows.length > 0) {
    const candidateCount = rows.length
    try {
      const reranked = await measureSearchStage('reranking', () =>
        runWithKnowledgeModelInputProvenance(registry, () =>
          rerank(
            input.query!,
            rows.map((row) => ({ id: row.id, text: row.content })),
            {
              model: input.rerankerModel!,
              topN: input.topK,
              workspaceId: context.workspaceId,

              apiKey: input.rerankerApiKey,
              signal: input.signal,
            }
          )
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
        rerankerStatus = 'applied'
      }
    } catch (error) {
      input.signal?.throwIfAborted()
      if (registry?.isPermanentlyIncomplete()) throw error
      logger.warn('Knowledge reranker failed; using vector ordering', {
        error: getErrorMessage(error),
        model: input.rerankerModel,
        candidateCount,
      })
      rows = rows.slice(0, input.topK)
      rerankerStatus = 'unavailable'
    }
    logger.info('Knowledge reranker completed', {
      status: rerankerStatus,
      candidateCount,
      resultCount: rows.length,
      workspaceId: context.workspaceId,
    })
  } else if (useReranker) {
    rows = rows.slice(0, input.topK)
  }

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
  if (shouldMeter && billingAttribution && baseCost && baseCost.total > 0) {
    try {
      await measureSearchStage('usage_recording', () =>
        recordUsage({
          userId,
          ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
          ...toBillingContext(billingAttribution),
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
      )
      await measureSearchStage('overage_billing', () =>
        checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
      )
    } catch (error) {
      logger.error('Failed to record Knowledge search usage', { error })
    }
  }

  const tagMaps = new Map(
    [...definitionsByKnowledgeBase].map(([knowledgeBaseId, definitions]) => [
      knowledgeBaseId,
      new Map(definitions.map((definition) => [definition.tagSlot, definition.displayName])),
    ])
  )
  /**
   * The provenance snapshot vouches for the name, URL, and tags a model may see; the source
   * card's modified time and connector type ride on the hydrated row, read under the same
   * predicate as the content.
   */
  const results = rows.map((row, index): KnowledgeSearchItem => {
    const metadata: Record<string, unknown> = {}
    const tagMap = tagMaps.get(row.knowledgeBaseId)
    const provenanceDocument = provenanceSnapshot?.documentMetadata[row.documentId]
    const document = provenanceDocument ?? row
    for (const slot of ALL_TAG_SLOTS) {
      const value =
        provenanceDocument && slot.startsWith('tag')
          ? provenanceDocument[slot as 'tag1' | 'tag2' | 'tag3' | 'tag4' | 'tag5' | 'tag6' | 'tag7']
          : row[slot]
      if (value !== null && value !== undefined) metadata[tagMap?.get(slot) ?? slot] = value
    }
    const rerankerScore = rerankerScores.get(row.id)
    const similarity = hasQuery ? 1 - row.distance : 1
    return {
      embeddingId: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      documentId: row.documentId,
      documentName: document?.filename ?? null,
      sourceUrl: document?.sourceUrl ?? null,
      sourceModifiedAt: row.sourceModifiedAt ?? null,
      connectorType: row.connectorType ?? null,
      content: row.content,
      chunkIndex: row.chunkIndex,
      metadata,
      similarity,
      rankScore: rerankerScore ?? row.rankScore ?? similarity,
      rank: index + 1,
      ...(rerankerScore !== undefined ? { rerankerScore } : {}),
    }
  })
  if (registry && provenanceSnapshot) {
    const renderedByDocument = new Map<
      string,
      Array<Pick<KnowledgeSearchItem, 'documentName' | 'sourceUrl' | 'metadata'>>
    >()
    for (const result of results) {
      const rendered = renderedByDocument.get(result.documentId) ?? []
      rendered.push({
        documentName: result.documentName,
        sourceUrl: result.sourceUrl,
        metadata: result.metadata,
      })
      renderedByDocument.set(result.documentId, rendered)
    }
    /** Each document's provenance stands alone, so they are imported together. */
    const imported = await measureSearchStage('metadata_provenance', () =>
      Promise.all(
        Object.entries(provenanceSnapshot.documentMetadata).map(([documentId, document]) => {
          const renderedMetadata = renderedByDocument.get(documentId)
          return renderedMetadata
            ? importDurableSecretProvenance(registry, document.provenance, renderedMetadata)
            : true
        })
      )
    )
    if (imported.includes(false)) {
      registry.markIncomplete('knowledge-result-provenance-unavailable')
    }
  }
  annotateSearchDiagnostics({ resultCount: results.length })
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
    retrieval: retrieved.retrieval,
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
    rerankerStatus,
    cost,
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    userId,
    accessScopeKind: access.kind,
    resultSecretRegistry: registry,
  }
}

/** What follows a completed search on every surface: the organization's activity record and the platform event. */
export async function afterKnowledgeSearch({
  principal,
  context,
  input,
  result,
}: {
  principal: Principal
  context: KnowledgeResourceContext
  input: Pick<SearchKnowledgeInput, 'surface'>
  result: SearchKnowledgeResult
}): Promise<void> {
  const actorUserId = resolvePrincipalSubjectUserId(principal)
  if (context.organizationId && actorUserId) {
    await measureSearchStage('activity_recording', () =>
      recordOrganizationSearchActivity({
        organizationId: context.organizationId,
        userId: actorUserId,
        surface: input.surface ?? 'other',
        results: result.results,
      })
    )
  }
  PlatformEvents.knowledgeBaseSearched({
    knowledgeBaseId: result.knowledgeBaseId,
    knowledgeBaseIds: result.knowledgeBaseIds,
    documentIds: [...new Set(result.results.map((item) => item.documentId))],
    connectorTypes: [
      ...new Set(
        result.results.flatMap((item) => (item.connectorType ? [item.connectorType] : []))
      ),
    ],
    resultsCount: result.totalResults,
    workspaceId: context.workspaceId,
    actorUserId: resolvePrincipalSubjectUserId(principal) ?? undefined,
    principalKind: principal.kind,
    delegatedServiceId:
      principal.kind === 'delegated' || principal.kind === 'organization_delegated'
        ? principal.serviceId
        : undefined,
    accessScopeKind: result.accessScopeKind,
    surface: input.surface,
  })
}

/** Search over explicitly named bases: resolves and authorizes them, then runs the shared search. */
const searchKnowledgeUseCase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ principal, input }: { principal: Principal; input: SearchKnowledgeInput }) =>
    measureSearchStage('knowledge_context', () => resolveKnowledgeSearchContext(input, principal)),
  execute: ({ principal, input, context }) => runKnowledgeSearch({ principal, input, context }),
  afterSuccess: ({ principal, context, input, result }) =>
    afterKnowledgeSearch({ principal, context, input, result }),
})

export const searchKnowledge = instrumentSearchUseCase(
  'knowledge_application',
  searchKnowledgeUseCase
)
