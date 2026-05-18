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
