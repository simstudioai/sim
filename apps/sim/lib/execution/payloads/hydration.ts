import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { materializeLargeValueRef } from '@/lib/execution/payloads/store'

export async function warmLargeValueRefs(
  value: unknown,
  seen = new WeakSet<object>()
): Promise<void> {
  if (!value || typeof value !== 'object') {
    return
  }

  if (isLargeValueRef(value)) {
    const materialized = await materializeLargeValueRef(value)
    await warmLargeValueRefs(materialized, seen)
    return
  }

  if (seen.has(value)) {
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    await Promise.all(value.map((item) => warmLargeValueRefs(item, seen)))
    return
  }

  await Promise.all(Object.values(value).map((entryValue) => warmLargeValueRefs(entryValue, seen)))
}
