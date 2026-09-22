import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'

const logger = createLogger('KnowledgeSearchDiagnostics', { logLevel: 'INFO' })
const PROGRESS_INTERVAL_MS = 5000

type RetrievalLeg = 'vector' | 'keyword' | 'tags'
export type SearchStage =
  | 'document_read'
  | 'document_read.sql'
  | 'tool_input'
  | 'tool_application'
  | 'tool_presentation'
  | 'workspace_application'
  | 'organization_application'
  | 'scoped_application'
  | 'knowledge_application'
  | 'scope_resolution'
  | 'knowledge_context'
  | 'index_resolution'
  | 'availability'
  | 'billing_attribution'
  | 'usage_admission'
  | 'tag_filters'
  | 'input_provenance'
  | 'embedding'
  | 'access_scope'
  | 'defaults'
  | 'retrieval'
  | 'access_plan'
  | 'live_source_grants'
  | 'vector.source_exact'
  | 'vector.source_walk'
  | 'permitted_documents'
  | 'result_provenance'
  | 'reranking'
  | 'usage_recording'
  | 'overage_billing'
  | 'tag_definitions'
  | 'metadata_provenance'
  | 'activity_recording'
  | RetrievalLeg
  | `${RetrievalLeg}.candidates`
  | `${RetrievalLeg}.hydration`
  | `${RetrievalLeg}.connection_acquire`
  | `${RetrievalLeg}.sql`
  | 'vector.settings'
  | 'vector.probe'
  | 'vector.page'
  | 'vector.projection_filled'
  | 'vector.source_indexes'
  | 'keyword.projection_filled'
  | 'vector.exact_candidates'
  | 'vector.exact'
  | 'vector.candidate_search'
  | 'keyword.tin'
  | 'keyword.tin_readiness'
  | 'keyword.tin_query'
  | 'source_overview'
  | 'source_overview.availability'
  | 'source_overview.providers'
  | 'source_overview.indexing'
  | 'source_overview.searchable'
  | 'access_batch.connectors'
  | 'access_batch.live_proof'

/** Fixed, content-free fields. Never pass queries, filters, document identities, SQL, or errors. */
export interface SearchDiagnosticMetadata {
  operation?: 'search_workspace' | 'read_document' | 'read_search_source_overview'
  surface?: 'dashboard' | 'mcp' | 'copilot' | 'workflow' | 'api' | 'slack' | 'other'
  toolCallId?: string
  executionId?: string
  scopeKind?: 'workspace' | 'organization'
  accessScopeKind?: 'workspace' | 'user'
  principalKind?: string
  topK?: number
  knowledgeBaseCount?: number
  documentFilterCount?: number
  hasSourceFilter?: boolean
  hasDateFilter?: boolean
  tagFilterCount?: number
  hasProvenance?: boolean
  searchMode?: 'hybrid' | 'vector'
  boostRecency?: boolean
  embeddingDimensions?: number
  vectorRanking?: 'exact' | 'exact-candidates' | 'projection-walk' | 'per-source'
  /**
   * Whether the bounded traversal filled its candidate limit. `underfilled` means visibility
   * removed enough neighbours that the rerank pool is smaller than requested, which lowers recall
   * without widening the scan. Not an assertion about the physical index PostgreSQL selected.
   */
  vectorCandidateScan?: 'planned' | 'underfilled'
  vectorBudgetMs?: number
  vectorCandidateLimit?: number
  /** Visible documents the tractability probe enumerated, capped at its own document limit. */
  vectorProbeDocumentCount?: number
  /**
   * Whether a user-scoped search resolved its permitted documents before retrieval: `bounded`
   * ranks inside that set, `unbounded` means it exceeded the probe's limit and both legs search
   * the index with the access predicate applied per candidate.
   */
  permittedDocuments?: 'bounded' | 'unbounded'
  /** Documents in a bounded permitted set. */
  permittedDocumentCount?: number
  vectorSourcesSliced?: number
  /** The sliced sources held more readable documents than one exact ranking may enumerate. */
  vectorSlicedSaturated?: boolean
  vectorSourcesWalked?: number
  /**
   * Which index ranked an unbounded keyword leg: `tin` ranks by BM25 and checks access on the top
   * of that ranking; `gin` ranks every match. Absent when the leg ranked inside a bounded set.
   */
  keywordRanking?: 'tin' | 'gin'
  /** Candidates Tin ranked before access was checked on the last keyword page. */
  keywordTinWindow?: number
  vectorCandidateCount?: number
  vectorCandidateDimensions?: number
  resultCount?: number
  /** Tool output before the executor's final egress projection; counts only, never content. */
  toolResultBytes?: number
  passageBytes?: number
  originalPassageBytes?: number
  retrievalStatus?: 'complete' | 'partial'
  timedOutLegs?: RetrievalLeg[]
  maxPassageBytes?: number
  uniqueDocumentCount?: number
  /**
   * Access predicates yielded to the caller. The first needs no query and no live proof; every
   * later one costs a connector discovery query plus a live source proof over the network.
   */
  accessBatchCount?: number
  /** Connector identities sent for live proof, summed over every batch after the first. */
  liveProofConnectorCount?: number
  /** Provider types with a configured search source, before any access probe. */
  configuredProviderCount?: number
  /** Searchable-document probes actually issued; one per batch until the answer is known. */
  searchableProbeCount?: number
}

interface StageTiming {
  count: number
  totalMs: number
  maxMs: number
  errors: number
}

interface SearchTrace {
  searchId: string
  startedAt: number
  metadata: SearchDiagnosticMetadata
  stages: Partial<Record<SearchStage, StageTiming>>
  active: Map<symbol, { stage: SearchStage; startedAt: number }>
}

const traces = new AsyncLocalStorage<SearchTrace>()
const roundMs = (value: number) => Math.round(value * 100) / 100

export function annotateSearchDiagnostics(metadata: SearchDiagnosticMetadata): void {
  const trace = traces.getStore()
  if (trace) Object.assign(trace.metadata, metadata)
}

export function recordSearchStageDuration(stage: SearchStage, milliseconds: number): void {
  const trace = traces.getStore()
  if (!trace) return
  const timing = (trace.stages[stage] ??= { count: 0, totalMs: 0, maxMs: 0, errors: 0 })
  timing.count++
  timing.totalMs = roundMs(timing.totalMs + milliseconds)
  timing.maxMs = roundMs(Math.max(timing.maxMs, milliseconds))
}

/** Timings include waiting on the dependency; nested and parallel stages must not be summed. */
export async function measureSearchStage<T>(
  stage: SearchStage,
  run: () => T | PromiseLike<T>
): Promise<T> {
  const trace = traces.getStore()
  if (!trace) return run()
  const span = Symbol(stage)
  const startedAt = performance.now()
  trace.active.set(span, { stage, startedAt })
  try {
    return await run()
  } catch (error) {
    const timing = (trace.stages[stage] ??= { count: 0, totalMs: 0, maxMs: 0, errors: 0 })
    timing.errors++
    throw error
  } finally {
    trace.active.delete(span)
    recordSearchStageDuration(stage, performance.now() - startedAt)
  }
}

/** One correlated summary per invocation, plus active stages every five seconds while stalled. */
export async function withSearchDiagnostics<T>(
  metadata: SearchDiagnosticMetadata,
  run: () => Promise<T>
): Promise<T> {
  if (traces.getStore()) {
    annotateSearchDiagnostics(metadata)
    return run()
  }
  const trace: SearchTrace = {
    searchId: generateId(),
    startedAt: performance.now(),
    metadata: { ...metadata },
    stages: {},
    active: new Map(),
  }
  return traces.run(trace, async () => {
    const snapshot = () => ({
      searchId: trace.searchId,
      ...trace.metadata,
      elapsedMs: roundMs(performance.now() - trace.startedAt),
      stages: structuredClone(trace.stages),
      activeStages: [...trace.active.values()].map(({ stage, startedAt }) => ({
        stage,
        elapsedMs: roundMs(performance.now() - startedAt),
      })),
    })
    const timer = setInterval(() => {
      logger.info('Knowledge search still running', snapshot())
    }, PROGRESS_INTERVAL_MS)
    timer.unref()
    let outcome = 'error'
    try {
      const result = await run()
      outcome =
        result && typeof result === 'object' && 'success' in result && result.success === false
          ? 'error'
          : trace.metadata.retrievalStatus === 'partial'
            ? 'partial'
            : 'success'
      return result
    } finally {
      clearInterval(timer)
      logger.info('Knowledge search completed', { ...snapshot(), outcome })
    }
  })
}
