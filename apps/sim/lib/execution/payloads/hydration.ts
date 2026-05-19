import { recordMaterializedAccessKeys } from '@/lib/execution/payloads/access-keys'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import {
  type LargeValueStoreContext,
  materializeLargeValueRef,
} from '@/lib/execution/payloads/store'

function withLocalMaterializedKeys(
  context: LargeValueStoreContext,
  materializedValue: unknown
): LargeValueStoreContext {
  recordMaterializedAccessKeys(context, materializedValue)
  return {
    ...context,
    largeValueKeys: context.largeValueKeys,
    fileKeys: context.fileKeys,
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
    await warmLargeValueRefs(materialized, withLocalMaterializedKeys(context, materialized), seen)
    return
  }

  if (seen.has(value)) {
    return
  }
  seen.add(value)

  if (isLargeArrayManifest(value)) {
    await warmLargeValueRefs(value.preview, context, seen)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      await warmLargeValueRefs(item, context, seen)
    }
    return
  }

  for (const entryValue of Object.values(value)) {
    await warmLargeValueRefs(entryValue, context, seen)
  }
}
