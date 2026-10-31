import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import type { LiveSearchProvider } from '@/lib/api/contracts/mothership-assistant-tools'

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
  | 'knowledge_application'
  | 'scope_resolution'
  | 'knowledge_context'
  | 'availability'
  | 'billing_attribution'
  | 'usage_admission'
  | 'tag_filters'
  | 'input_provenance'
  | 'embedding'
  | 'access_scope'
  | 'defaults'
  | 'retrieval'
  | 'live_source_grants'
  | 'permitted_documents'
  | 'result_provenance'
  | 'reranking'
  | 'usage_recording'
  | 'overage_billing'
  | 'tag_definitions'
  | 'metadata_provenance'
  | RetrievalLeg
  | `${RetrievalLeg}.candidates`
  | `${RetrievalLeg}.hydration`
  | `${RetrievalLeg}.connection_acquire`
  | `${RetrievalLeg}.sql`
  | 'vector.settings'
  | 'vector.probe'
  | 'vector.page'
  | 'vector.exact_candidates'
  | 'vector.exact'
  | 'vector.candidate_search'
  | 'access_batch.connectors'
  | 'access_batch.live_proof'
  | 'live.policies'
  | 'live.accounts'
  | 'live.resolve'
  | 'live.session'
  | 'live.search'
  | 'live.verify'
  | 'live.preview'
  | 'live.read'

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
  vectorRanking?: 'exact' | 'exact-candidates' | 'projection-walk'
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
  accountCount?: number
  searchedAccountCount?: number
  nativeQueryCount?: number
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
  active: Map<
    symbol,
    { stage: SearchStage; startedAt: number; provider?: LiveSearchProvider; accountIndex?: number }
  >
}

const traces = new AsyncLocalStorage<SearchTrace>()
const providers = new AsyncLocalStorage<ProviderTrace>()
const currentStages = new AsyncLocalStorage<SearchStage>()
const currentQueries = new AsyncLocalStorage<number | undefined>()
const roundMs = (value: number) => Math.round(value * 100) / 100

const MAX_PROVIDER_REQUEST_DIAGNOSTICS = 128
const FAILURE_REASONS = [
  'provider_validation',
  'provider_access_denied',
  'provider_rate_limited',
  'provider_http_error',
  'request_budget_exceeded',
  'mcp_tool_unavailable',
  'mcp_schema_incompatible',
  'mcp_tool_error',
  'mcp_payload_too_large',
  'mcp_payload_unreadable',
  'mcp_account_required',
] as const
export type SearchFailureReason = (typeof FAILURE_REASONS)[number]

const ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_ABORTED',
  'ABORT_ERR',
  'ERR_STREAM_PREMATURE_CLOSE',
  'MANAGED_CREDENTIAL_NOT_FOUND',
  'MANAGED_CREDENTIAL_UNAVAILABLE',
  'MANAGED_CREDENTIAL_PROVIDER_MISMATCH',
  'MANAGED_CREDENTIAL_REVOKED',
  'MANAGED_CREDENTIAL_NEEDS_REAUTH',
  'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE',
  'MANAGED_CREDENTIAL_INVALID_TOKEN_SET',
  'MANAGED_CREDENTIAL_CONFIGURATION_UNAVAILABLE',
  'MANAGED_CREDENTIAL_IDENTITY_UNAVAILABLE',
  'MANAGED_CREDENTIAL_REFRESH_FAILED',
])

interface ProviderMetadata {
  provider: LiveSearchProvider
  accountIndex: number
}

interface ProviderResult {
  queryIndex?: number
  status: 'ok' | 'partial' | 'reconnect' | 'rate_limited' | 'unavailable' | 'timeout'
  resultCount: number
  coverage?: {
    unverified: boolean
    verificationRateLimited: boolean
    servicePartial: boolean
    providerPartial: boolean
    undatedExcluded: boolean
    undatedUnsorted: boolean
    moreUnsorted: boolean
    moreUnreachable: boolean
    emptyContinuable: boolean
  }
}

interface RequestMetadata {
  transport: 'native_http' | 'mcp'
  method?: 'GET' | 'POST'
  /** Only code-allowlisted tool names; never remote descriptions or arguments. */
  tool?: string
}

interface RequestOutcome {
  httpStatus?: number
  /** Provider reason codes already filtered through the provider's fixed allowlist. */
  providerReasons?: string[]
}

interface RequestDiagnostic extends RequestMetadata, RequestOutcome {
  stage?: SearchStage
  queryIndex?: number
  startedAfterMs: number
  elapsedMs?: number
  outcome?: 'success' | 'error'
  failure?: ReturnType<typeof describeFailure>
}

interface ProviderTrace {
  searchId: string
  closed: boolean
  pendingRequestCount: number
  metadata: ProviderMetadata
  startedAt: number
  stages: Partial<Record<SearchStage, StageTiming>>
  results: Array<ProviderResult & { failure?: ReturnType<typeof describeFailure> }>
  requests: RequestDiagnostic[]
  requestCount: number
  failedRequestCount: number
}

/** Error messages, stacks, response bodies, and arbitrary provider codes never enter logs. */
function describeFailure(error: unknown) {
  const record = toRecord(error)
  const code = (value: unknown) =>
    typeof value === 'string' && ERROR_CODES.has(value)
      ? value
      : typeof value === 'number' &&
          [-32700, -32600, -32601, -32602, -32603, -32000, -32001].includes(value)
        ? value
        : undefined
  const reason =
    FAILURE_REASONS.find((candidate) => candidate === record.diagnosticCode) ??
    (record.name === 'AbortError'
      ? 'aborted'
      : record.name === 'PayloadSizeLimitError'
        ? 'response_size_limit'
        : record.name === 'SyntaxError'
          ? 'invalid_json'
          : record.name === 'TimeoutError'
            ? 'timeout'
            : 'unexpected_error')
  const httpStatus =
    typeof record.httpStatus === 'number' &&
    Number.isInteger(record.httpStatus) &&
    record.httpStatus >= 100 &&
    record.httpStatus <= 599
      ? record.httpStatus
      : undefined
  const errorCode = code(record.code)
  const causeCode = code(toRecord(record.cause).code)
  return {
    reason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(errorCode === undefined ? {} : { code: errorCode }),
    ...(causeCode === undefined ? {} : { causeCode }),
  }
}

/** A provider keeps its own waterfall while sharing the request's search ID and stage totals. */
export async function withSearchProviderDiagnostics<T>(
  metadata: ProviderMetadata,
  run: () => Promise<T>
): Promise<T> {
  const root = traces.getStore()
  if (!root) return run()
  const provider: ProviderTrace = {
    searchId: root.searchId,
    closed: false,
    pendingRequestCount: 0,
    metadata,
    startedAt: performance.now(),
    stages: {},
    results: [],
    requests: [],
    requestCount: 0,
    failedRequestCount: 0,
  }
  return providers.run(provider, async () => {
    let failure: ReturnType<typeof describeFailure> | undefined
    try {
      return await run()
    } catch (error) {
      failure = describeFailure(error)
      throw error
    } finally {
      provider.closed = true
      logger.info('Live search provider completed', {
        searchId: root.searchId,
        ...metadata,
        startedAfterMs: roundMs(provider.startedAt - root.startedAt),
        elapsedMs: roundMs(performance.now() - provider.startedAt),
        outcome: failure
          ? 'error'
          : provider.results.some((result) => result.status !== 'ok')
            ? 'partial'
            : 'success',
        ...(failure ? { failure } : {}),
        stages: provider.stages,
        results: provider.results,
        requests: structuredClone(provider.requests),
        requestCount: provider.requestCount,
        failedRequestCount: provider.failedRequestCount,
        pendingRequestCount: provider.pendingRequestCount,
        omittedRequestCount: provider.requestCount - provider.requests.length,
      })
    }
  })
}

/** Captures query-level failures even when the application returns other providers' results. */
export function recordSearchProviderResult(result: ProviderResult, error?: unknown): void {
  providers.getStore()?.results.push({
    ...result,
    ...(error === undefined ? {} : { failure: describeFailure(error) }),
  })
}

/** Native query ordinals distinguish parallel requests without retaining their query text. */
export function withSearchQueryDiagnostics<T>(
  queryIndex: number | undefined,
  run: () => Promise<T>
): Promise<T> {
  return currentQueries.run(queryIndex, run)
}

/** Bounded request records retain failures swallowed by fallbacks and verification filters. */
export async function withSearchRequestDiagnostics<T>(
  metadata: RequestMetadata,
  run: (record: (outcome: RequestOutcome) => void) => Promise<T>
): Promise<T> {
  const provider = providers.getStore()
  if (!provider) return run(() => undefined)
  const startedAt = performance.now()
  const diagnostic: RequestDiagnostic = {
    ...metadata,
    stage: currentStages.getStore(),
    queryIndex: currentQueries.getStore(),
    startedAfterMs: roundMs(startedAt - provider.startedAt),
  }
  provider.requestCount++
  const requestIndex = provider.requestCount - 1
  provider.pendingRequestCount++
  const retained = provider.requests.length < MAX_PROVIDER_REQUEST_DIAGNOSTICS
  if (retained) provider.requests.push(diagnostic)
  try {
    const result = await run((outcome) => Object.assign(diagnostic, outcome))
    diagnostic.outcome = 'success'
    return result
  } catch (error) {
    provider.failedRequestCount++
    diagnostic.outcome = 'error'
    diagnostic.failure = describeFailure(error)
    throw error
  } finally {
    diagnostic.elapsedMs = roundMs(performance.now() - startedAt)
    provider.pendingRequestCount--
    if (provider.closed && retained) {
      logger.info('Live search request completed after provider', {
        searchId: provider.searchId,
        ...provider.metadata,
        requestIndex,
        ...diagnostic,
      })
    }
  }
}

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
  const provider = providers.getStore()
  if (provider) {
    const local = (provider.stages[stage] ??= { count: 0, totalMs: 0, maxMs: 0, errors: 0 })
    local.count++
    local.totalMs = roundMs(local.totalMs + milliseconds)
    local.maxMs = roundMs(Math.max(local.maxMs, milliseconds))
  }
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
  trace.active.set(span, { stage, startedAt, ...providers.getStore()?.metadata })
  try {
    return await currentStages.run(stage, run)
  } catch (error) {
    const timing = (trace.stages[stage] ??= { count: 0, totalMs: 0, maxMs: 0, errors: 0 })
    timing.errors++
    const provider = providers.getStore()
    if (provider) {
      const local = (provider.stages[stage] ??= { count: 0, totalMs: 0, maxMs: 0, errors: 0 })
      local.errors++
    }
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
      activeStages: [...trace.active.values()].map(({ startedAt, ...active }) => ({
        ...active,
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
