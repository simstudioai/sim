import {
  getLargeValueMaterializationError,
  isLargeValueRef,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'

/**
 * In-memory retention for large execution values. Durable storage is the
 * source of truth — every recoverable entry also exists in object storage and
 * transparently re-fetches through the async materialize path on a miss — so
 * this layer is an accelerator plus one deliberate exception: an entry whose
 * durable persist failed (`recoverable: false`) is the value's ONLY copy, and
 * pressure eviction must never remove it (losing it fails the execution that
 * stored it; expiry is its only exit).
 *
 * Lifetimes are IDLE TTLs, not absolute: every successful read refreshes the
 * entry and moves it to the back of the eviction order, so a value a live run
 * keeps referencing cannot expire mid-use, and pressure eviction always takes
 * the least-recently-used recoverable entry. The TTL must comfortably outlive
 * the gap between an execution's warm pass (`warmLargeValueRefs`, which runs
 * ONCE at execution start over the resumed snapshot) and that value's first
 * sync reference during the run — shorten it only if the warm becomes
 * per-block.
 */
const FALLBACK_TTL_MS = 15 * 60 * 1000
const MAX_IN_MEMORY_BYTES = 256 * 1024 * 1024
const SWEEP_INTERVAL_MS = 60 * 1000

interface LargeValueCacheScope {
  workspaceId?: string
  workflowId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
}

const inMemoryValues = new Map<
  string,
  {
    value: unknown
    size: number
    expiresAt: number
    scope?: LargeValueCacheScope
    recoverable: boolean
  }
>()
let inMemoryBytes = 0

let sweepTimer: ReturnType<typeof setInterval> | null = null

export function clearLargeValueCacheForTests(): void {
  inMemoryValues.clear()
  inMemoryBytes = 0
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

/**
 * Point-in-time occupancy of the in-memory large-value cache, for the periodic
 * memory-telemetry snapshot. `trackedBytes` is the JSON-serialized accounting
 * the admission/eviction budget uses — the retained heap of the parsed values
 * is a multiple of it, which is exactly what comparing this line against
 * `heapUsedMB` in the same snapshot is meant to expose.
 */
export function getLargeValueCacheStats(): { entries: number; trackedBytes: number } {
  return { entries: inMemoryValues.size, trackedBytes: inMemoryBytes }
}

function cleanupExpiredValues(now = Date.now()): void {
  for (const [id, entry] of inMemoryValues.entries()) {
    if (entry.expiresAt <= now) {
      inMemoryValues.delete(id)
      inMemoryBytes -= entry.size
    }
  }
}

/**
 * Keeps the fallback TTL honest on quiet instances. Expiry was previously
 * enforced only inside `cacheLargeValue`/`materializeLargeValueRefSync`, so on
 * an instance that stopped storing large values the last entries — up to the
 * full budget, held as parsed object graphs — sat in memory indefinitely
 * instead of for `FALLBACK_TTL_MS`. The timer is unref'd so it never holds the
 * process open, and retires itself once the cache drains (the next insert
 * restarts it), so an idle process carries no interval at all.
 */
function ensureSweepTimer(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    cleanupExpiredValues()
    if (inMemoryValues.size === 0 && sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref()
}

export function cacheLargeValue(
  id: string,
  value: unknown,
  size: number,
  scope?: LargeValueCacheScope,
  options: { recoverable?: boolean } = {}
): boolean {
  if (size > MAX_IN_MEMORY_BYTES) {
    return false
  }

  cleanupExpiredValues()

  const existing = inMemoryValues.get(id)
  if (existing) {
    inMemoryValues.delete(id)
    inMemoryBytes -= existing.size
  }

  while (inMemoryBytes + size > MAX_IN_MEMORY_BYTES && inMemoryValues.size > 0) {
    const oldestRecoverableId = Array.from(inMemoryValues.entries()).find(
      ([, entry]) => entry.recoverable
    )?.[0]
    if (!oldestRecoverableId) break
    const oldest = inMemoryValues.get(oldestRecoverableId)
    inMemoryValues.delete(oldestRecoverableId)
    inMemoryBytes -= oldest?.size ?? 0
  }

  if (inMemoryBytes + size > MAX_IN_MEMORY_BYTES) {
    if (existing) {
      inMemoryValues.set(id, existing)
      inMemoryBytes += existing.size
    }
    return false
  }

  inMemoryValues.set(id, {
    value,
    size,
    scope,
    recoverable: options.recoverable ?? false,
    expiresAt: Date.now() + FALLBACK_TTL_MS,
  })
  inMemoryBytes += size
  ensureSweepTimer()
  return true
}

function scopeMatchesRef(
  ref: LargeValueRef,
  cachedScope: LargeValueCacheScope | undefined,
  callerScope?: LargeValueCacheScope
): boolean {
  if (!cachedScope?.executionId) {
    return false
  }
  if (ref.executionId && ref.executionId !== cachedScope.executionId) {
    return false
  }
  if (!callerScope) {
    return Boolean(ref.key) && (!ref.executionId || ref.executionId === cachedScope.executionId)
  }

  const allowedExecutionIds = new Set([
    callerScope.executionId,
    ...(callerScope.largeValueExecutionIds ?? []),
  ])
  if (ref.key && callerScope.largeValueKeys?.includes(ref.key)) {
    return true
  }
  const workflowScopeAllowed =
    callerScope.allowLargeValueWorkflowScope &&
    callerScope.workspaceId === cachedScope.workspaceId &&
    callerScope.workflowId === cachedScope.workflowId

  return allowedExecutionIds.has(cachedScope.executionId) || Boolean(workflowScopeAllowed)
}

export function materializeLargeValueRefSync(
  ref: LargeValueRef,
  callerScope?: LargeValueCacheScope
): unknown {
  cleanupExpiredValues()
  const cached = inMemoryValues.get(ref.id)
  if (!cached || !scopeMatchesRef(ref, cached.scope, callerScope)) {
    return undefined
  }
  // Idle-TTL touch on every authorized read: refresh expiry and move the entry
  // to the back of the eviction order. A value a live run keeps referencing can
  // therefore never expire or be pressure-evicted mid-use — expiry and eviction
  // only ever take entries nothing has read for a full TTL. Touching must stay
  // behind the scope check so an unauthorized probe cannot extend a lifetime.
  cached.expiresAt = Date.now() + FALLBACK_TTL_MS
  inMemoryValues.delete(ref.id)
  inMemoryValues.set(ref.id, cached)
  return cached.value
}

export function materializeLargeValueRefSyncOrThrow(
  ref: LargeValueRef,
  callerScope?: LargeValueCacheScope
): unknown {
  const materialized = materializeLargeValueRefSync(ref, callerScope)
  if (materialized === undefined) {
    throw getLargeValueMaterializationError(ref)
  }
  return materialized
}

export function materializeLargeValueRefsSync(
  value: unknown,
  seen = new WeakSet<object>()
): unknown {
  if (isLargeValueRef(value)) {
    return materializeLargeValueRefsSync(materializeLargeValueRefSyncOrThrow(value), seen)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return value
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => materializeLargeValueRefsSync(item, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      materializeLargeValueRefsSync(entryValue, seen),
    ])
  )
}
