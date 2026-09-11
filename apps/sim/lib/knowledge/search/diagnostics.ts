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
  | 'result_provenance'
  | 'reranking'
  | 'usage_recording'
  | 'overage_billing'
  | 'tag_definitions'
  | 'metadata'
  | 'metadata.authorization'
  | 'metadata.sql'
  | 'metadata_provenance'
  | 'activity_recording'
  | RetrievalLeg
  | `${RetrievalLeg}.candidates`
  | `${RetrievalLeg}.authorization`
  | `${RetrievalLeg}.hydration`
  | `${RetrievalLeg}.connection_acquire`
  | `${RetrievalLeg}.sql`
  | 'vector.settings'
  | 'vector.probe'
  | 'vector.ann'
  | 'vector.exact'

/** Fixed, content-free fields. Never pass queries, filters, document identities, SQL, or errors. */
export interface SearchDiagnosticMetadata {
  operation?: 'search_workspace' | 'read_document'
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
  resultCount?: number
  /** Tool output before the executor's final egress projection; counts only, never content. */
  toolResultBytes?: number
  passageBytes?: number
  originalPassageBytes?: number
  retrievalStatus?: 'complete' | 'partial'
  timedOutLegs?: RetrievalLeg[]
  maxPassageBytes?: number
  uniqueDocumentCount?: number
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
          : 'success'
      return result
    } finally {
      clearInterval(timer)
      logger.info('Knowledge search completed', { ...snapshot(), outcome })
    }
  })
}
