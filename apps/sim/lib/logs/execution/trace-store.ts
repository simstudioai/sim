import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'

const logger = createLogger('TraceStore')

/**
 * Key under which the externalized-execution-data pointer (a `__simLargeValueRef`)
 * is stored on the slim `execution_data` row.
 */
export const TRACE_STORE_REF_KEY = 'traceStoreRef'

/**
 * The only metadata kept inline on the slim row (everything else lives in the
 * externalized object). These two describe trace presence/count and uniquely
 * survive object expiry — so a reader can still report "trace data expired (N
 * spans)" after retention without an object fetch. All other fields
 * (environment, trigger, tokens, models, truncation flags, and of course the
 * heavy payloads) are in the stored object and recovered on materialize, so
 * keeping them inline too would just be duplication.
 */
const INLINE_MARKER_KEYS = ['hasTraceSpans', 'traceSpanCount'] as const

/**
 * Read-path context. Resolves an externalized payload by storage key, authorized
 * via the (already-authorized) workspace — no owner needed.
 */
interface TraceStoreReadContext {
  workspaceId: string | null
  workflowId: string | null
  executionId: string
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
