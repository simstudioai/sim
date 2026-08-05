import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'
import {
  hasPersistedBlockStates,
  recoverLegacyWorkflowInputForDisplay,
} from '@/lib/logs/execution/legacy-workflow-input'
import {
  projectTraceSpansForSecrets,
  projectWorkflowBoundarySpansForSecrets,
} from '@/lib/logs/execution/trace-secret-projection'
import type { TraceSpan } from '@/lib/logs/types'
import {
  isResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('TraceStore')

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
 */
const INLINE_MARKER_KEYS = ['hasTraceSpans', 'traceSpanCount', 'correlation'] as const

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

/**
 * Workflow-boundary content: the inbound trigger payload, captured before any
 * secret is resolved. It structurally cannot hold a Sim-resolved secret, so it
 * stays readable when provenance is missing. `finalOutput` is deliberately not
 * here - it sits downstream of every block and can carry a resolved secret, so
 * it fails closed with the rest of the execution content.
 */
const LOG_DISPLAY_BOUNDARY_KEYS = ['workflowInput'] as const

/**
 * Content that can hold a resolved secret. Only rendered when the run carries
 * provable provenance for the secrets it resolved.
 */
const LOG_DISPLAY_GATED_KEYS = [
  'finalOutput',
  'blockInput',
  'blockExecutions',
  'error',
  'errorDetails',
  'completionFailure',
  'message',
] as const

const LOG_DISPLAY_CONTENT_KEYS = [...LOG_DISPLAY_BOUNDARY_KEYS, ...LOG_DISPLAY_GATED_KEYS] as const

const LOG_DISPLAY_PROJECTION_SPAN_ID = 'secret-safe-log-display-projection'
const LOG_DISPLAY_BOUNDARY_SPAN_ID = 'secret-safe-log-display-boundary'

/**
 * Trigger types whose `workflowInput` is NOT an inbound payload.
 *
 * A nested execution is handed its input by the PARENT run:
 * `workflow-handler.ts` passes `workflowInput: childWorkflowInput`, assembled
 * from `inputs.inputMapping` / `inputs.input` - already-resolved parent block
 * outputs. So for these runs the boundary premise ("captured before any secret
 * was resolved") does not hold, and `workflowInput` stays gated with the rest
 * of the execution content.
 *
 * Deliberately a denylist, not an allowlist: webhook runs record the PROVIDER
 * as the trigger type (`zoho_desk`, `slack`, ...), so an allowlist of known
 * inbound types would fail closed on the exact population this exemption
 * exists to serve. The nested set is small and enumerated in-repo
 * (`CORE_TRIGGER_TYPES`), so a denylist is the bounded side.
 */
const NESTED_EXECUTION_TRIGGER_TYPES = new Set(['workflow', 'custom_block'])

function triggerRecord(
  executionData: Record<string, unknown>
): Record<string, unknown> | undefined {
  const trigger = executionData.trigger
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return undefined
  return trigger as Record<string, unknown>
}

function isNestedExecution(executionData: Record<string, unknown>): boolean {
  const type = triggerRecord(executionData)?.type
  return typeof type === 'string' && NESTED_EXECUTION_TRIGGER_TYPES.has(type)
}

/**
 * Whether this run's input was copied from a prior execution
 * (`inputFromExecutionId`), stamped by `LoggingSession.setInputSourceExecutionId`.
 *
 * A re-run presents whatever trigger type its caller asked for, so the nested
 * check alone cannot see that the value originated in a nested run. Without
 * this, a secret resolved inside a custom-block parent could be copied into a
 * `manual` run and exempted. The inherited value carries the SOURCE run's
 * exposure, which this run's provenance cannot describe, so it stays gated.
 */
function hasInheritedInput(executionData: Record<string, unknown>): boolean {
  const data = triggerRecord(executionData)?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  return typeof (data as Record<string, unknown>).inputSourceExecutionId === 'string'
}

/**
 * Wraps display content in a span so it passes through the same secret
 * projection the executor's trace spans do.
 */
function createDisplayEnvelopeSpan(id: string, envelope: Record<string, unknown>): TraceSpan {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Log Display Projection',
    type: 'display',
    duration: 0,
    startTime: now,
    endTime: now,
    output: envelope,
  }
}

function copyProjectedEnvelope(
  projected: unknown,
  keys: readonly string[],
  target: Record<string, unknown>
): void {
  if (!projected || typeof projected !== 'object') return
  for (const key of keys) {
    if (Object.hasOwn(projected, key)) target[key] = (projected as Record<string, unknown>)[key]
  }
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
 * Projects execution-log content with the encrypted provenance saved by the
 * trusted executor. Missing or malformed provenance deliberately yields
 * structural-only content instead of returning content that cannot be proven
 * safe. The one exception is `workflowInput`, captured before any secret is
 * resolved - see {@link projectWorkflowBoundarySpansForSecrets}.
 */
export async function projectExecutionDataForDisplay(
  executionData: Record<string, unknown>,
  context: TraceStoreReadContext
): Promise<Record<string, unknown>> {
  const executionState =
    executionData.executionState &&
    typeof executionData.executionState === 'object' &&
    !Array.isArray(executionData.executionState)
      ? (executionData.executionState as Record<string, unknown>)
      : undefined
  const provenance = executionState?.resolvedSecretTraceProvenance
  let registry: ResolvedSecretTraceRegistry | undefined

  if (isResolvedSecretTraceProvenanceV1(provenance)) {
    registry = new ResolvedSecretTraceRegistry([], provenance.scope)
    await registry.importProvenance(provenance, { trusted: true })
  }

  /**
   * A nested run's input came from its parent's resolved outputs, and a re-run's
   * came from another execution. Neither is a pre-resolution inbound payload, so
   * both forgo the boundary exemption - every content key is gated for them.
   */
  const nested = isNestedExecution(executionData) || hasInheritedInput(executionData)
  const gatedKeys: readonly string[] = nested ? LOG_DISPLAY_CONTENT_KEYS : LOG_DISPLAY_GATED_KEYS
  const boundaryKeys: readonly string[] = nested ? [] : LOG_DISPLAY_BOUNDARY_KEYS

  const gatedEnvelope: Record<string, unknown> = {}
  for (const key of gatedKeys) {
    if (Object.hasOwn(executionData, key)) gatedEnvelope[key] = executionData[key]
  }

  const boundaryEnvelope: Record<string, unknown> = {}
  for (const key of boundaryKeys) {
    if (Object.hasOwn(executionData, key)) boundaryEnvelope[key] = executionData[key]
  }
  /**
   * Legacy recovery sources from block state, which is gated content, so it is
   * restricted to executions that predate provenance stamping. Every terminal
   * completion path now stamps `resolvedSecretTraceProvenance` - an incomplete
   * registry still exports a present `{complete: false, entries: []}` - so an
   * absent key identifies a pre-stamping run, without dating the row. Runs
   * written after stamping keep only their persisted `workflowInput`.
   *
   * The block-state requirement closes the one gap in that signal: a run that
   * fails before the registry is installed also lands with no key. Such a run
   * never reached the executor, so requiring block states excludes it here
   * rather than relying on the recovery happening to find nothing.
   */
  if (
    !nested &&
    provenance === undefined &&
    boundaryEnvelope.workflowInput === undefined &&
    hasPersistedBlockStates(executionData)
  ) {
    const recovered = recoverLegacyWorkflowInputForDisplay(executionData)
    if (recovered !== undefined) boundaryEnvelope.workflowInput = recovered
  }

  const store = {
    workspaceId: context.workspaceId ?? undefined,
    workflowId: context.workflowId ?? undefined,
    executionId: context.executionId,
    userId: context.userId,
    trackReference: false,
  }
  const sourceTraceSpans = Array.isArray(executionData.traceSpans)
    ? (executionData.traceSpans as TraceSpan[])
    : []
  const [projectedSpans, projectedBoundarySpans] = await Promise.all([
    projectTraceSpansForSecrets(
      [
        createDisplayEnvelopeSpan(LOG_DISPLAY_PROJECTION_SPAN_ID, gatedEnvelope),
        ...sourceTraceSpans,
      ],
      { registry, allowLargeValueWrites: false, store }
    ),
    Object.keys(boundaryEnvelope).length === 0
      ? []
      : projectWorkflowBoundarySpansForSecrets(
          [createDisplayEnvelopeSpan(LOG_DISPLAY_BOUNDARY_SPAN_ID, boundaryEnvelope)],
          { registry, allowLargeValueWrites: false, store }
        ),
  ])

  const displayData = omit(executionData, [
    ...LOG_DISPLAY_CONTENT_KEYS,
    'executionState',
    'traceSpans',
  ]) as Record<string, unknown>

  copyProjectedEnvelope(
    projectedSpans.find((span) => span.id === LOG_DISPLAY_PROJECTION_SPAN_ID)?.output,
    gatedKeys,
    displayData
  )
  copyProjectedEnvelope(
    projectedBoundarySpans.find((span) => span.id === LOG_DISPLAY_BOUNDARY_SPAN_ID)?.output,
    boundaryKeys,
    displayData
  )

  if (Array.isArray(executionData.traceSpans)) {
    displayData.traceSpans = projectedSpans.filter(
      (span) => span.id !== LOG_DISPLAY_PROJECTION_SPAN_ID
    )
  }

  return displayData
}
