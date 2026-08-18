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
 * Recursively removes `cost` from trace spans before persistence. Cost lives in
 * exactly one place — the usage_log ledger — so persisted spans carry only
 * structure, timing, and tokens (KTD7). Must run AFTER `calculateCostSummary`
 * has consumed span costs in memory.
 */
export function stripSpanCosts(spans: unknown): void {
  if (!Array.isArray(spans)) return
  for (const span of spans) {
    if (!span || typeof span !== 'object') continue
    const record = span as { cost?: unknown; children?: unknown }
    if ('cost' in record) record.cost = undefined
    if (Array.isArray(record.children)) stripSpanCosts(record.children)
  }
}

/** Creates a persistence-owned span tree with per-span cost fields removed. */
export function copyTraceSpansWithoutCosts(spans?: TraceSpan[]): TraceSpan[] | undefined {
  return spans?.map(({ cost: _cost, children, ...span }) => ({
    ...span,
    ...(children ? { children: copyTraceSpansWithoutCosts(children) } : {}),
  }))
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

  const runRegistry = await importResolvedSecretTraceRegistry(
    materialized[RESOLVED_SECRET_PROVENANCE_KEY] ??
      executionState?.[RESOLVED_SECRET_PROVENANCE_KEY],
    'traceStore.blockOutputRunProvenance'
  )
  const blockOutputs = new Map<string, unknown>()
  const projectionStore = createReadOnlyProjectionStore(context)

  for (const blockId of new Set(blockIds)) {
    const blockState = readRecord(blockStates[blockId])
    if (!blockState || blockState.output === undefined) continue

    const hasExactProvenance = Object.hasOwn(blockState, RESOLVED_SECRET_PROVENANCE_KEY)
    const registry = hasExactProvenance
      ? await importResolvedSecretTraceRegistry(
          blockState[RESOLVED_SECRET_PROVENANCE_KEY],
          'traceStore.blockOutputExactProvenance'
        )
      : runRegistry
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

  return { executionData: displayData, blockOutputs }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecordLike(value) ? (value as Record<string, unknown>) : undefined
}

async function importResolvedSecretTraceRegistry(
  provenance: unknown,
  origin: string
): Promise<ResolvedSecretTraceRegistry | undefined> {
  if (!isResolvedSecretTraceProvenanceV1(provenance)) return undefined

  const registry = new ResolvedSecretTraceRegistry([], provenance.scope)
  await registry.importProvenance(provenance, { trusted: true, origin })
  return registry
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

  const registry = await importResolvedSecretTraceRegistry(provenance, 'traceStore.spanProvenance')

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

    const exactProvenance = executionState[provenanceKey]
    const exactRegistry = isResolvedSecretTraceProvenanceV1(exactProvenance)
      ? new ResolvedSecretTraceRegistry([], exactProvenance.scope)
      : new ResolvedSecretTraceRegistry()
    if (isResolvedSecretTraceProvenanceV1(exactProvenance)) {
      await exactRegistry.importProvenance(exactProvenance, {
        trusted: true,
        origin: 'traceStore.exactProvenance',
      })
    } else {
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
