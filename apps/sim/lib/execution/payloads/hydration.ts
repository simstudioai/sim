import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import {
  type LargeValueStoreContext,
  materializeLargeValueRef,
} from '@/lib/execution/payloads/store'

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
    await warmLargeValueRefs(materialized, context, seen)
    return
  }

  if (seen.has(value)) {
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    await Promise.all(value.map((item) => warmLargeValueRefs(item, context, seen)))
    return
  }

  await Promise.all(
    Object.values(value).map((entryValue) => warmLargeValueRefs(entryValue, context, seen))
  )
}
