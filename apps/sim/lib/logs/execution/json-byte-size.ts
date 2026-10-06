import { getErrorMessage } from '@sim/utils/errors'
import { quotedStringBytes } from '@/lib/core/utils/bounded-json'
import { unboxJsonPrimitive } from '@/lib/core/utils/boxed-primitives'

/**
 * Byte length of `JSON.stringify(value)`, measured without building the string.
 * Stops early and returns `maxBytes + 1` once the count passes `maxBytes`. A
 * cycle or BigInt, which `JSON.stringify` rejects, is still measured (the cycle
 * edge as absent, the BigInt as its string) so oversized data stays eligible
 * for compaction; callers treat `undefined` as fitting. Returns `undefined` only
 * if a `toJSON` throws.
 */
export function getJsonByteSize(value: unknown, maxBytes: number): number | undefined {
  // Ancestors only: JSON.stringify writes a shared subtree once per occurrence,
  // so only a true cycle may be skipped.
  const ancestors = new WeakSet<object>()
  let bytes = 0

  const add = (amount: number) => {
    bytes += amount
    if (bytes > maxBytes) {
      throw new Error('json_size_limit_reached')
    }
  }

  const addString = (value: string) => {
    add(quotedStringBytes(value, maxBytes - bytes) ?? maxBytes - bytes + 1)
  }

  /** Applies `toJSON`, then unboxes primitive wrappers, as `JSON.stringify` does. */
  const resolve = (raw: unknown, key: string): unknown => {
    const toJSON =
      (typeof raw === 'object' && raw !== null) ||
      typeof raw === 'function' ||
      typeof raw === 'bigint'
        ? (raw as { toJSON?: unknown }).toJSON
        : undefined
    const value = typeof toJSON === 'function' ? toJSON.call(raw, key) : raw
    return typeof value === 'object' && value !== null ? unboxJsonPrimitive(value) : value
  }

  const isOmitted = (item: unknown): boolean =>
    item === undefined || typeof item === 'function' || typeof item === 'symbol'

  /** A container whose members are still being measured. Iterative, so nesting depth cannot overflow the stack. */
  type Frame = {
    node: object
    keys: string[] | undefined
    length: number
    index: number
    written: number
  }
  const stack: Frame[] = []

  /** Measures a resolved value; a container's members are measured as the loop below reaches them. */
  const enter = (item: unknown): void => {
    if (item === null || isOmitted(item)) {
      add(4)
      return
    }
    if (typeof item === 'string') {
      addString(item)
      return
    }
    if (typeof item === 'bigint') {
      addString(item.toString())
      return
    }
    if (typeof item === 'number' || typeof item === 'boolean') {
      add(Buffer.byteLength(JSON.stringify(item) ?? 'null', 'utf8'))
      return
    }
    if (typeof item !== 'object' || ancestors.has(item)) {
      return
    }
    ancestors.add(item)
    add(2)
    const keys = Array.isArray(item) ? undefined : Object.keys(item)
    stack.push({
      node: item,
      keys,
      length: keys ? keys.length : (item as unknown[]).length,
      index: 0,
      written: 0,
    })
  }

  try {
    enter(resolve(value, ''))
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame.index >= frame.length) {
        ancestors.delete(frame.node)
        stack.pop()
        continue
      }
      const index = frame.index++
      if (!frame.keys) {
        if (index > 0) add(1)
        enter(resolve((frame.node as unknown[])[index], String(index)))
        continue
      }
      const key = frame.keys[index]
      const entry = resolve((frame.node as Record<string, unknown>)[key], key)
      if (isOmitted(entry)) continue
      if (frame.written++ > 0) add(1)
      addString(key)
      add(1)
      enter(entry)
    }
    return bytes
  } catch (error) {
    if (getErrorMessage(error) === 'json_size_limit_reached') {
      return maxBytes + 1
    }
    return undefined
  }
}
