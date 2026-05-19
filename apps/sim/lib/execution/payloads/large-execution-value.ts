import {
  isLargeArrayManifest,
  type LargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'

export type LargeExecutionValue = LargeValueRef | LargeArrayManifest

/**
 * Parses execution values that must survive type coercion as refs.
 */
export function parseLargeExecutionValue(value: unknown): LargeExecutionValue | undefined {
  if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
    return value
  }

  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value)
    return isLargeValueRef(parsed) || isLargeArrayManifest(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Finds execution IDs referenced by large values embedded in persisted execution state.
 */
export function collectLargeValueExecutionIds(value: unknown): string[] {
  const executionIds = new Set<string>()
  collectLargeValueExecutionIdsInto(value, executionIds, new WeakSet<object>())
  return Array.from(executionIds)
}

export function collectLargeValueKeys(value: unknown): string[] {
  const keys = new Set<string>()
  collectLargeValueKeysInto(value, keys, new WeakSet<object>())
  return Array.from(keys)
}

function collectLargeValueExecutionIdsInto(
  value: unknown,
  executionIds: Set<string>,
  seen: WeakSet<object>
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (seen.has(value)) {
    return
  }
  seen.add(value)

  if (isLargeValueRef(value)) {
    addExecutionId(value, executionIds)
    collectLargeValueExecutionIdsInto(value.preview, executionIds, seen)
    return
  }

  if (isLargeArrayManifest(value)) {
    for (const chunk of value.chunks) {
      addExecutionId(chunk.ref, executionIds)
    }
    collectLargeValueExecutionIdsInto(value.preview, executionIds, seen)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectLargeValueExecutionIdsInto(item, executionIds, seen)
    }
    return
  }

  for (const item of Object.values(value)) {
    collectLargeValueExecutionIdsInto(item, executionIds, seen)
  }
}

function addExecutionId(ref: LargeValueRef, executionIds: Set<string>): void {
  if (ref.executionId) {
    executionIds.add(ref.executionId)
  }
}

function collectLargeValueKeysInto(value: unknown, keys: Set<string>, seen: WeakSet<object>): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (seen.has(value)) {
    return
  }
  seen.add(value)

  if (isLargeValueRef(value)) {
    addKey(value, keys)
    collectLargeValueKeysInto(value.preview, keys, seen)
    return
  }

  if (isLargeArrayManifest(value)) {
    for (const chunk of value.chunks) {
      addKey(chunk.ref, keys)
    }
    collectLargeValueKeysInto(value.preview, keys, seen)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectLargeValueKeysInto(item, keys, seen)
    }
    return
  }

  for (const item of Object.values(value)) {
    collectLargeValueKeysInto(item, keys, seen)
  }
}

function addKey(ref: LargeValueRef, keys: Set<string>): void {
  if (ref.key) {
    keys.add(ref.key)
  }
}
