import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike, omit } from '@sim/utils/object'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'
import { FunctionalOutputsUnavailableError } from '@/lib/logs/execution/functional-outputs'
import { projectTraceSpansForSecrets } from '@/lib/logs/execution/trace-secret-projection'
import type { TraceSpan } from '@/lib/logs/types'
import {
  isResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('TraceStore')

/** Marks execution data written under the resolved-secret display contract. */
export const SECRET_PROJECTION_VERSION = 1 as const

/**
 * Key under which the externalized-execution-data pointer (a `__simLargeValueRef`)
 * is stored on the slim `execution_data` row.
 */
export const TRACE_STORE_REF_KEY = 'traceStoreRef'

/**
 * The only metadata kept inline on the slim row (everything else lives in the
 * externalized object). Trace presence/count survives object expiry for log
 * diagnostics, while correlation preserves the server-issued binding used to
 * authenticate terminal Copilot workflow-tool executions. All other fields
 * (environment, trigger, tokens, models, truncation flags, and of course the
 * heavy payloads) are recovered from the stored object.
 *
 * {@link RESOLVED_SECRET_PROVENANCE_KEY} is deliberately absent: it rides in the
 * externalized object, and inlining it would put encrypted secret material back
 * on the row this slimming exists to keep it off.
 */
const INLINE_MARKER_KEYS = [
  'secretProjectionVersion',
  'hasTraceSpans',
  'traceSpanCount',
  'correlation',
] as const

/**
 * Top-level `execution_data` key carrying the run's resolved-secret provenance.
 *
 * Duplicated out of `executionState` because oversized-payload compaction drops
 * that field wholesale, leaving a contract-marked row the display projection
 * can no longer verify. Server-side only: it holds encrypted secret values and
 * their names, so every display projection must omit it.
 */
export const RESOLVED_SECRET_PROVENANCE_KEY = 'resolvedSecretTraceProvenance'

/**
 * Server-only keys stripped from every display projection. Both the contract
 * and legacy paths spread this, so a new server-only key is omitted from both
 * by construction rather than by review.
 */
const DISPLAY_OMITTED_SERVER_KEYS = [
  'executionState',
  'secretProjectionVersion',
  RESOLVED_SECRET_PROVENANCE_KEY,
] as const

/**
 * Read-path context. Resolves an externalized payload by storage key, authorized
 * via the (already-authorized) workspace — no owner needed.
 */
export interface TraceStoreReadContext {
  workspaceId: string | null
  workflowId: string | null
  executionId: string
  userId?: string
}

export interface DisplayExecutionDataWithBlockOutputs {
  executionData: Record<string, unknown>
  blockOutputs: Map<string, unknown>
}

/**
 * Write-path context. Requires the execution owner's `userId`: the externalized
 * object is tracked in `workspace_files`, whose `user_id` column is NOT NULL
 * (FK -> user.id). Requiring it here makes "a write needs an owner" a
 * compile-time invariant, so callers must resolve the owner before persisting.
 */
interface TraceStoreWriteContext extends TraceStoreReadContext {
  userId: string
}

/**
 * Recovers the workflowId embedded in a large-value storage key
 * (`execution/{workspaceId}/{workflowId}/{executionId}/<file>`). Used when the
 * log row's workflowId has been nulled by workflow deletion.
 */
function workflowIdFromStorageKey(key: string | undefined): string | undefined {
  if (!key) return undefined
  const parts = key.split('/')
  return parts.length >= 5 && parts[0] === 'execution' ? parts[2] : undefined
}

/**
 * Recursively removes spend from trace spans, in place.
 *
 * `tokens` is optional because the two callers withhold different things.
 * Persistence withholds only dollars — cost lives in exactly one place, the
 * usage_log ledger (KTD7), so a stored span carries structure, timing and
 * tokens. A joined cross-workspace child run withholds the whole amount: its
 * token counts are the same spend in another unit, recoverable by anyone who
 * knows the model's rate.
 *
 * Must run AFTER `calculateCostSummary` has consumed span costs in memory.
 */
function stripSpanSpendFields(spans: unknown, options: { tokens: boolean }): void {
  if (!Array.isArray(spans)) return
  for (const span of spans) {
    if (!span || typeof span !== 'object') continue
    const record = span as {
      cost?: unknown
      tokens?: unknown
      children?: unknown
      providerTiming?: unknown
    }
    if ('cost' in record) record.cost = undefined
    if (options.tokens && 'tokens' in record) record.tokens = undefined
    stripProviderTimingSegmentSpend(record.providerTiming, options)
    if (Array.isArray(record.children)) stripSpanSpendFields(record.children, options)
  }
}

/**
 * Removes per-span `cost` before persistence, leaving tokens in place.
 *
 * The one strip that WRITES: `backfill-trace-spans.ts` runs it over a legacy
 * row's spans and stores the result, so anything it clears is gone for every
 * authorized reader of that run, forever. Only cost belongs in that set — the
 * ledger owns the dollars, and the spans have never been the place they live.
 */
export function stripSpanCosts(spans: unknown): void {
  stripSpanSpendFields(spans, { tokens: false })
}

/**
 * Removes cost AND token counts from a joined child run's spans, in memory.
 *
 * The child's spend is billed to the SOURCE workspace and was never rolled into
 * the parent run's total, so leaving any of it would publish spend the reader
 * was never meant to see and make the waterfall contradict the run cost above
 * it. A read-time projection only: these spans are hydrated onto a response and
 * never written back.
 */
export function stripJoinedChildTraceSpend(spans: unknown): void {
  stripSpanSpendFields(spans, { tokens: true })
}

/**
 * The same removal one level down, in `providerTiming.segments`.
 *
 * A `ProviderTimingSegment` carries its own `tokens` and `cost` — the per-model
 * iteration breakdown behind the span's roll-up — so clearing the span alone
 * left the whole figure itemized underneath it, which is strictly more than the
 * span published in the first place.
 */
function stripProviderTimingSegmentSpend(
  providerTiming: unknown,
  options: { tokens: boolean }
): void {
  if (!providerTiming || typeof providerTiming !== 'object') return
  const segments = (providerTiming as { segments?: unknown }).segments
  if (!Array.isArray(segments)) return
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue
    const record = segment as { cost?: unknown; tokens?: unknown }
    if ('cost' in record) record.cost = undefined
    if (options.tokens && 'tokens' in record) record.tokens = undefined
  }
}

/**
 * Copies exactly the nodes {@link stripSpanSpendFields} writes to — each span,
 * its children, its `providerTiming`, and that timing's segments — and shares
 * every other value with the caller's tree. Enough isolation for the strip to
 * run in place without reaching the in-memory spans the rest of the run still
 * holds, and no deep clone of the payloads hanging off a span.
 */
function copySpanTreeForStrip(spans: TraceSpan[]): TraceSpan[] {
  return spans.map((span) => {
    const copy: TraceSpan = { ...span }
    if (Array.isArray(copy.children)) copy.children = copySpanTreeForStrip(copy.children)
    if (copy.providerTiming && typeof copy.providerTiming === 'object') {
      const { segments } = copy.providerTiming
      copy.providerTiming = {
        ...copy.providerTiming,
        ...(Array.isArray(segments)
          ? {
              segments: segments.map((segment) =>
                segment && typeof segment === 'object' ? { ...segment } : segment
              ),
            }
          : {}),
      }
    }
    return copy
  })
}

/**
 * Creates a persistence-owned span tree with spend removed, for the COMPLETION
 * write.
 *
 * Runs the same {@link stripSpanCosts} the legacy backfill does, over a copy —
 * one removal rule for both writers, which is the point: this used to drop the
 * span's own `cost` and nothing else, so every completed run persisted the
 * itemized dollars underneath it in `providerTiming.segments`, which the backfill
 * had already learned to clear. Tokens survive, on both paths: the ledger owns
 * the dollars, and a span's token counts are trace detail the reader is entitled
 * to.
 */
export function copyTraceSpansWithoutCosts(spans?: TraceSpan[]): TraceSpan[] | undefined {
  if (!spans) return undefined
  const copy = copySpanTreeForStrip(spans)
  stripSpanCosts(copy)
  return copy
}

/**
 * Externalizes heavy `execution_data` to object storage as a single large value
 * (reusing the execution-context large-value store + its reference/dependency/GC
 * machinery — KTD4/KTD8), returning a slim row payload that keeps inline markers
 * plus the `__simLargeValueRef` pointer.
 *
 * On any failure (no scope, oversized, storage error) the original (already
 * cost-stripped) execution data is returned unchanged so the log is never lost.
 */
export async function externalizeExecutionData(
  executionData: Record<string, unknown>,
  context: TraceStoreWriteContext
): Promise<Record<string, unknown>> {
  const { workspaceId, workflowId, executionId, userId } = context
  // workspaceId/workflowId build the storage key and can be null for
  // deleted-workflow rows. userId is type-guaranteed by TraceStoreWriteContext;
  // the falsy check is a defensive guard against an empty string. If any are
  // missing the durable write can't succeed, so keep the data inline.
  if (!workspaceId || !workflowId || !userId) return executionData

  try {
    const json = JSON.stringify(executionData)
    const size = Buffer.byteLength(json, 'utf8')

    // storeLargeValue persists to the execution bucket with a conforming key and
    // registers owner + dependency closure (trace -> nested span large values),
    // so GC keeps nested children alive while this run's log row exists.
    const ref = await storeLargeValue(executionData, json, size, {
      workspaceId,
      workflowId,
      executionId,
      userId,
      requireDurable: true,
    })

    const { preview: _preview, ...slimRef } = ref

    const slim: Record<string, unknown> = { [TRACE_STORE_REF_KEY]: slimRef }
    for (const key of INLINE_MARKER_KEYS) {
      if (key in executionData) slim[key] = executionData[key]
    }
    return slim
  } catch (error) {
    logger.warn('Failed to externalize execution data; keeping inline', {
      executionId,
      error: toError(error).message,
    })
    return executionData
  }
}

/**
 * Resolves an `execution_data` row into its full form for reads. When the row
 * carries a trace-store pointer, the payload is materialized from storage and
 * merged with the inline markers; otherwise the row is returned unchanged
 * (inline / pre-externalization runs). One level only — nested span
 * `__simLargeValueRef` stubs remain as previews, matching prior behavior.
 *
 * Returns metadata-only (the slim row minus the pointer) if the object is
 * missing/unreadable (e.g. post-retention) so reads degrade rather than crash.
 */
export async function materializeExecutionData(
  executionData: Record<string, unknown> | null | undefined,
  context: TraceStoreReadContext
): Promise<Record<string, unknown>> {
  if (!executionData) return {}

  const ref = executionData[TRACE_STORE_REF_KEY]
  if (!isLargeValueRef(ref)) return executionData

  const { [TRACE_STORE_REF_KEY]: _pointer, ...markers } = executionData

  if (!context.workspaceId) return markers

  // workflowId is `set null` on workflow delete, but the ref key embeds the
  // original workflowId — recover it so deleted-workflow logs stay readable.
  // Workspace authorization still comes from the (authorized) caller context.
  const workflowId = context.workflowId ?? workflowIdFromStorageKey(ref.key)
  if (!workflowId) return markers

  try {
    const materialized = await materializeLargeValueRef(ref, {
      workspaceId: context.workspaceId,
      workflowId,
      executionId: context.executionId,
      maxBytes: ref.size,
      // Read-only: the value is already referenced by its own execution; don't
      // re-register (or fail) on every view/export.
      trackReference: false,
    })

    if (!materialized || typeof materialized !== 'object') {
      logger.warn('Trace store object unavailable; returning metadata only', {
        executionId: context.executionId,
        key: ref.key,
      })
      return markers
    }

    return { ...(materialized as Record<string, unknown>), ...markers }
  } catch (error) {
    logger.warn('Failed to materialize execution data; returning metadata only', {
      executionId: context.executionId,
      error: toError(error).message,
    })
    return markers
  }
}

const LOG_DISPLAY_CONTENT_KEYS = [
  'finalOutput',
  'workflowInput',
  'blockInput',
  'blockExecutions',
  'error',
  'errorDetails',
  'completionFailure',
  'message',
] as const

const LOG_DISPLAY_PROJECTION_SPAN_ID = 'secret-safe-log-display-projection'
const EXACT_LOG_VALUE_PROVENANCE_KEYS = {
  finalOutput: 'finalOutputResolvedSecretTraceProvenance',
  workflowInput: 'workflowInputResolvedSecretTraceProvenance',
} as const

/** Returns historical execution data using the display behavior from before secret provenance. */
function projectLegacyExecutionDataForDisplay(
  executionData: Record<string, unknown>
): Record<string, unknown> {
  const omittedKeys = [
    ...DISPLAY_OMITTED_SERVER_KEYS,
    ...(!Object.hasOwn(executionData, 'traceSpans') || Array.isArray(executionData.traceSpans)
      ? []
      : ['traceSpans']),
  ]

  return omit(executionData, omittedKeys) as Record<string, unknown>
}

/**
 * Materializes trusted execution data and returns its log-facing projection.
 * Functional readers must continue using {@link materializeExecutionData}.
 */
export async function materializeExecutionDataForDisplay(
  executionData: Record<string, unknown> | null | undefined,
  context: TraceStoreReadContext
): Promise<Record<string, unknown>> {
  const materialized = await materializeExecutionData(executionData, context)
  return projectExecutionDataForDisplay(materialized, context)
}

/**
 * Materializes one trusted row into its display envelope plus secret-safe functional outputs.
 * Only requested execution-state outputs are projected and returned; trace spans remain display
 * data and the raw execution state never crosses the display boundary.
 */
export async function materializeExecutionDataForDisplayWithBlockOutputs(
  executionData: Record<string, unknown> | null | undefined,
  context: TraceStoreReadContext,
  blockIds: readonly string[]
): Promise<DisplayExecutionDataWithBlockOutputs> {
  const materialized = await materializeExecutionData(executionData, context)
  const displayData = await projectExecutionDataForDisplay(materialized, context)
  if (blockIds.length === 0) {
    return { executionData: displayData, blockOutputs: new Map() }
  }

  const executionState = readRecord(materialized.executionState)
  const blockStates = readRecord(executionState?.blockStates)
  if (!blockStates) {
    if (materialized.executionDataTruncated === true) {
      throw new FunctionalOutputsUnavailableError()
    }
    return { executionData: displayData, blockOutputs: new Map() }
  }

  const runImport = await importStoredDisplayEnvelope(
    materialized[RESOLVED_SECRET_PROVENANCE_KEY] ??
      executionState?.[RESOLVED_SECRET_PROVENANCE_KEY],
    'traceStore.blockOutputRunProvenance'
  )
  const provenanceFaults = new Map<string, StoredDisplayProvenanceFault>()
  if (runImport.fault) provenanceFaults.set('run', runImport.fault)
  const blockOutputs = new Map<string, unknown>()
  const projectionStore = createReadOnlyProjectionStore(context)

  for (const blockId of new Set(blockIds)) {
    const blockState = readRecord(blockStates[blockId])
    if (!blockState || blockState.output === undefined) continue

    let registry = runImport.registry
    if (Object.hasOwn(blockState, RESOLVED_SECRET_PROVENANCE_KEY)) {
      const blockImport = await importStoredDisplayEnvelope(
        blockState[RESOLVED_SECRET_PROVENANCE_KEY],
        'traceStore.blockOutputExactProvenance'
      )
      if (blockImport.fault) provenanceFaults.set(`blockOutput:${blockId}`, blockImport.fault)
      registry = blockImport.registry
    }
    const now = new Date().toISOString()
    const [projected] = await projectTraceSpansForSecrets(
      [
        {
          id: `${LOG_DISPLAY_PROJECTION_SPAN_ID}-block-output`,
          name: 'Block Output Display Projection',
          type: 'display',
          duration: 0,
          startTime: now,
          endTime: now,
          output: { value: blockState.output },
        },
      ],
      { registry, allowLargeValueWrites: false, store: projectionStore }
    )
    if (projected?.output && Object.hasOwn(projected.output, 'value')) {
      blockOutputs.set(blockId, projected.output.value)
    }
  }
  reportStoredDisplayProvenanceFaults('traceStore.blockOutputs', context, provenanceFaults)

  return { executionData: displayData, blockOutputs }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecordLike(value) ? (value as Record<string, unknown>) : undefined
}

type StoredDisplayProvenanceFault = 'incomplete' | 'malformed' | 'undecryptable'

interface StoredDisplayEnvelopeImport {
  registry: ResolvedSecretTraceRegistry | undefined
  fault: StoredDisplayProvenanceFault | undefined
}

/**
 * Staged: display registries filter stored values for one materialization and are discarded, and
 * their own mark-time summaries name no execution — the read boundary reports instead, through
 * {@link reportStoredDisplayProvenanceFaults}. A stored envelope's incompleteness is not an event
 * on this path; it was recorded when the run wrote it, and every later view re-derives it.
 *
 * The fault is classified where the import happens so every consumer reports the same way: an
 * absent envelope is not a fault (truncation has its own warning), a present value that does not
 * parse is `malformed`, a parsed envelope that cannot vouch is `incomplete`, and a complete
 * envelope whose registry latched during import — entry decryption is the only latch on this
 * trusted path — is `undecryptable`. Projection withholds the guarded values in all three cases.
 */
async function importStoredDisplayEnvelope(
  provenance: unknown,
  origin: string
): Promise<StoredDisplayEnvelopeImport> {
  if (provenance === undefined) return { registry: undefined, fault: undefined }
  if (!isResolvedSecretTraceProvenanceV1(provenance)) {
    return { registry: undefined, fault: 'malformed' }
  }

  const registry = new ResolvedSecretTraceRegistry([], provenance.scope, { staged: true })
  await registry.importProvenance(provenance, { trusted: true, origin })
  const fault = !provenance.complete
    ? 'incomplete'
    : registry.isPermanentlyIncomplete()
      ? 'undecryptable'
      : undefined
  return { registry, fault }
}

const MAX_REPORTED_PROVENANCE_FAULT_PARTS = 20

const STORED_PROVENANCE_FAULT_REPORTS = {
  incomplete: {
    level: 'warn',
    message: 'Stored execution provenance cannot vouch for display content',
  },
  malformed: { level: 'error', message: 'Stored execution provenance is malformed' },
  /** The entry-level decrypt error already logs its counts; this adds the execution it hit. */
  undecryptable: { level: 'error', message: 'Stored execution provenance could not be decrypted' },
} as const satisfies Record<
  StoredDisplayProvenanceFault,
  { level: 'warn' | 'error'; message: string }
>

/**
 * One attributed line per fault kind per display function, in place of one registry summary per
 * envelope per view.
 *
 * The registry summaries these replace carried counts and a workspace but no execution id, so a
 * reader repeatedly materializing the same stored rows produced an unattributable stream — the
 * lines could not say which executions to go look at. Severity follows the registry reason each
 * fault replaces: incomplete at warn (a stored state being re-read), malformed and undecryptable
 * at error (faults wherever they are met).
 *
 * A block-outputs read runs the display projection first, so a faulted run envelope appears once
 * under each site — `traceSpans` guarding the span projection, `run` as the block fallback. Two
 * sites reading the same envelope are two facts about the view; collapsing them would couple the
 * display functions to share reporting state for one line less.
 */
function reportStoredDisplayProvenanceFaults(
  site: string,
  context: TraceStoreReadContext,
  faults: ReadonlyMap<string, StoredDisplayProvenanceFault>
): void {
  if (faults.size === 0) return
  const details = {
    site,
    executionId: context.executionId,
    ...(context.workflowId ? { workflowId: context.workflowId } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
  }
  for (const [kind, report] of Object.entries(STORED_PROVENANCE_FAULT_REPORTS) as [
    StoredDisplayProvenanceFault,
    (typeof STORED_PROVENANCE_FAULT_REPORTS)[StoredDisplayProvenanceFault],
  ][]) {
    const parts = [...faults].filter(([, fault]) => fault === kind).map(([part]) => part)
    if (parts.length === 0) continue
    logger[report.level](report.message, {
      ...details,
      fault: kind,
      parts: parts.slice(0, MAX_REPORTED_PROVENANCE_FAULT_PARTS),
      partCount: parts.length,
    })
  }
}

function createReadOnlyProjectionStore(context: TraceStoreReadContext) {
  return {
    workspaceId: context.workspaceId ?? undefined,
    workflowId: context.workflowId ?? undefined,
    executionId: context.executionId,
    userId: context.userId,
    trackReference: false,
  }
}

/**
 * Projects execution-log content with the encrypted provenance saved by the
 * trusted executor. Current workflow input and final output values use their
 * exact sidecars; rows predating those fields retain the run-level fallback.
 * Contract-aware rows whose provenance is missing or malformed yield
 * structural-only content rather than data that cannot be proven safe. The one
 * carve-out is the trace spans of a truncated row that lost its provenance to
 * compaction: those were already projected at write time. Truncation also takes
 * the exact per-value sidecars with it, so those rows fall back to the
 * run-level registry for `finalOutput` / `workflowInput`.
 */
export async function projectExecutionDataForDisplay(
  executionData: Record<string, unknown>,
  context: TraceStoreReadContext
): Promise<Record<string, unknown>> {
  const executionState = readRecord(executionData.executionState)
  const hasTopLevelProvenance = Object.hasOwn(executionData, RESOLVED_SECRET_PROVENANCE_KEY)
  const stateProvenance = executionState?.[RESOLVED_SECRET_PROVENANCE_KEY]
  const provenance = executionData[RESOLVED_SECRET_PROVENANCE_KEY] ?? stateProvenance
  const hasProjectionContract =
    Object.hasOwn(executionData, 'secretProjectionVersion') ||
    hasTopLevelProvenance ||
    (executionState !== undefined && Object.hasOwn(executionState, RESOLVED_SECRET_PROVENANCE_KEY))

  if (!hasProjectionContract) {
    return projectLegacyExecutionDataForDisplay(executionData)
  }

  const provenanceFaults = new Map<string, StoredDisplayProvenanceFault>()
  const runImport = await importStoredDisplayEnvelope(provenance, 'traceStore.spanProvenance')
  const registry = runImport.registry
  if (runImport.fault) provenanceFaults.set('traceSpans', runImport.fault)

  /**
   * Compaction drops `executionState`, and with it the only copy of the
   * provenance on rows written before it was stored top-level. Every write path
   * projects spans before persisting them, and that projection yields
   * structural-only spans when its registry is incomplete — so a stored tree
   * that still carries content was already redacted at write time.
   *
   * Not a general fallback: scoped to truncated rows whose key is absent
   * entirely. A present-but-unusable key (malformed, incomplete, explicit null)
   * and the read-time envelope have no such guarantee and keep failing closed.
   *
   * Self-expiring. New rows carry the key, so this only serves rows truncated
   * before that shipped; once the warning below stops firing across a full log
   * retention window, delete this branch and its tests.
   */
  const retainStoredTraceSpans =
    executionData.executionDataTruncated === true &&
    !hasTopLevelProvenance &&
    stateProvenance === undefined &&
    Array.isArray(executionData.traceSpans) &&
    executionData.traceSpans.length > 0
  if (retainStoredTraceSpans) {
    logger.warn('Retaining write-time-projected spans for a truncated row with no provenance', {
      executionId: context.executionId,
    })
  }

  const projectionStore = createReadOnlyProjectionStore(context)

  const exactValueProjections = new Map<string, unknown>()
  for (const [valueKey, provenanceKey] of Object.entries(EXACT_LOG_VALUE_PROVENANCE_KEYS)) {
    if (
      !Object.hasOwn(executionData, valueKey) ||
      !executionState ||
      !Object.hasOwn(executionState, provenanceKey)
    ) {
      continue
    }

    const exactImport = await importStoredDisplayEnvelope(
      executionState[provenanceKey],
      'traceStore.exactProvenance'
    )
    if (exactImport.fault) provenanceFaults.set(valueKey, exactImport.fault)
    /**
     * The exact value must project against SOME registry, so an unusable envelope gets a latched
     * one — the projection then withholds the value rather than passing it through unguarded.
     */
    let exactRegistry = exactImport.registry
    if (!exactRegistry) {
      exactRegistry = new ResolvedSecretTraceRegistry([], undefined, { staged: true })
      exactRegistry.markIncomplete('untrusted-provenance', { origin: 'traceStore.exactProvenance' })
    }

    const [projected] = await projectTraceSpansForSecrets(
      [
        {
          id: `${LOG_DISPLAY_PROJECTION_SPAN_ID}-${valueKey}`,
          name: 'Exact Log Value Display Projection',
          type: 'display',
          duration: 0,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          output: { value: executionData[valueKey] },
        },
      ],
      { registry: exactRegistry, allowLargeValueWrites: false, store: projectionStore }
    )
    if (projected?.output && Object.hasOwn(projected.output, 'value')) {
      exactValueProjections.set(valueKey, projected.output.value)
    }
  }
  reportStoredDisplayProvenanceFaults('traceStore.displayProjection', context, provenanceFaults)

  const envelope: Record<string, unknown> = {}
  for (const key of LOG_DISPLAY_CONTENT_KEYS) {
    const exactProvenanceKey =
      EXACT_LOG_VALUE_PROVENANCE_KEYS[key as keyof typeof EXACT_LOG_VALUE_PROVENANCE_KEYS]
    if (
      Object.hasOwn(executionData, key) &&
      (!exactProvenanceKey || !executionState || !Object.hasOwn(executionState, exactProvenanceKey))
    ) {
      envelope[key] = executionData[key]
    }
  }

  const now = new Date().toISOString()
  const syntheticSpan: TraceSpan = {
    id: LOG_DISPLAY_PROJECTION_SPAN_ID,
    name: 'Log Display Projection',
    type: 'display',
    duration: 0,
    startTime: now,
    endTime: now,
    output: envelope,
  }
  const sourceTraceSpans = Array.isArray(executionData.traceSpans)
    ? (executionData.traceSpans as TraceSpan[])
    : []
  const spansToProject = retainStoredTraceSpans ? [] : sourceTraceSpans
  const projectedSpans = await projectTraceSpansForSecrets([syntheticSpan, ...spansToProject], {
    registry,
    allowLargeValueWrites: false,
    store: projectionStore,
  })

  const displayData = omit(executionData, [
    ...LOG_DISPLAY_CONTENT_KEYS,
    ...DISPLAY_OMITTED_SERVER_KEYS,
    'traceSpans',
  ]) as Record<string, unknown>

  const projectedEnvelope = projectedSpans.find(
    (span) => span.id === LOG_DISPLAY_PROJECTION_SPAN_ID
  )?.output
  if (projectedEnvelope) {
    for (const key of LOG_DISPLAY_CONTENT_KEYS) {
      if (Object.hasOwn(projectedEnvelope, key)) displayData[key] = projectedEnvelope[key]
    }
  }
  for (const [key, value] of exactValueProjections) {
    displayData[key] = value
  }

  if (Array.isArray(executionData.traceSpans)) {
    displayData.traceSpans = retainStoredTraceSpans
      ? sourceTraceSpans
      : projectedSpans.filter((span) => span.id !== LOG_DISPLAY_PROJECTION_SPAN_ID)
  }

  return displayData
}
