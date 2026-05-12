import {
  getLargeValueMaterializationError,
  isLargeValueRef,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'

const FALLBACK_TTL_MS = 15 * 60 * 1000
const MAX_IN_MEMORY_BYTES = 256 * 1024 * 1024

interface LargeValueCacheScope {
  workspaceId?: string
  workflowId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
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

export function clearLargeValueCacheForTests(): void {
  inMemoryValues.clear()
  inMemoryBytes = 0
}

function cleanupExpiredValues(now = Date.now()): void {
  for (const [id, entry] of inMemoryValues.entries()) {
    if (entry.expiresAt <= now) {
      inMemoryValues.delete(id)
      inMemoryBytes -= entry.size
    }
  }
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
