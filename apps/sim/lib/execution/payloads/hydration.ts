import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { collectLargeValueKeys } from '@/lib/execution/payloads/large-execution-value'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import {
  type LargeValueStoreContext,
  materializeLargeValueRef,
} from '@/lib/execution/payloads/store'

function withLocalLargeValueKeys(
  context: LargeValueStoreContext,
  materializedValue: unknown
): LargeValueStoreContext {
  const sourceKeys = collectLargeValueKeys(materializedValue)
  if (sourceKeys.length === 0) {
    return context
  }
  if (!context.largeValueKeys) {
    context.largeValueKeys = []
  }
  const existingKeys = new Set(context.largeValueKeys)
  for (const key of sourceKeys) {
    if (!existingKeys.has(key)) {
      existingKeys.add(key)
      context.largeValueKeys.push(key)
    }
  }
  return {
    ...context,
    largeValueKeys: context.largeValueKeys,
  }
}

export async function warmLargeValueRefs(
  value: unknown,
  context: LargeValueStoreContext = {},
  seen = new WeakSet<object>()
): Promise<void> {
  if (!value || typeof value !== 'object') {
    return
  }

  if (isLargeValueRef(value)) {
    const materialized = await materializeLargeValueRef(value, context)
    await warmLargeValueRefs(materialized, withLocalLargeValueKeys(context, materialized), seen)
    return
  }

  if (seen.has(value)) {
    return
  }
  seen.add(value)

  if (isLargeArrayManifest(value)) {
    return
  }

  if (Array.isArray(value)) {
    await Promise.all(value.map((item) => warmLargeValueRefs(item, context, seen)))
    return
  }

  await Promise.all(
    Object.values(value).map((entryValue) => warmLargeValueRefs(entryValue, context, seen))
  )
}
