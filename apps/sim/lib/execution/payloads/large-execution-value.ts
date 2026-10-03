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

export function collectLargeValueKeys(value: unknown): string[] {
  const keys = new Set<string>()
  collectLargeValueKeysInto(value, keys, new WeakSet<object>())
  return Array.from(keys)
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
