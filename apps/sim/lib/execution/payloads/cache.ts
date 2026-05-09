import {
  getLargeValueMaterializationError,
  isLargeValueRef,
  type LargeValueRef,
} from '@/lib/execution/payloads/large-value-ref'

const FALLBACK_TTL_MS = 15 * 60 * 1000
const MAX_IN_MEMORY_BYTES = 256 * 1024 * 1024

const inMemoryValues = new Map<string, { value: unknown; size: number; expiresAt: number }>()
let inMemoryBytes = 0

function cleanupExpiredValues(now = Date.now()): void {
  for (const [id, entry] of inMemoryValues.entries()) {
    if (entry.expiresAt <= now) {
      inMemoryValues.delete(id)
      inMemoryBytes -= entry.size
    }
  }
}

export function cacheLargeValue(id: string, value: unknown, size: number): void {
  if (size > MAX_IN_MEMORY_BYTES) {
    return
  }

  cleanupExpiredValues()

  while (inMemoryBytes + size > MAX_IN_MEMORY_BYTES && inMemoryValues.size > 0) {
    const oldestId = inMemoryValues.keys().next().value
    if (!oldestId) break
    const oldest = inMemoryValues.get(oldestId)
    inMemoryValues.delete(oldestId)
    inMemoryBytes -= oldest?.size ?? 0
  }

  inMemoryValues.set(id, {
    value,
    size,
    expiresAt: Date.now() + FALLBACK_TTL_MS,
  })
  inMemoryBytes += size
}

export function materializeLargeValueRefSync(ref: LargeValueRef): unknown {
  cleanupExpiredValues()
  return inMemoryValues.get(ref.id)?.value
}

export function materializeLargeValueRefSyncOrThrow(ref: LargeValueRef): unknown {
  const materialized = materializeLargeValueRefSync(ref)
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
