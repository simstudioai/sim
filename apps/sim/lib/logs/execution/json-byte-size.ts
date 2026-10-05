import { getErrorMessage } from '@sim/utils/errors'
import { quotedStringBytes } from '@/lib/core/utils/bounded-json'

/**
 * Approximate byte length of `JSON.stringify(value)`, measured without building
 * the string. Stops early and returns `maxBytes + 1` once the count passes
 * `maxBytes`; returns `undefined` if the walk fails.
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
      (typeof raw === 'object' && raw !== null) || typeof raw === 'bigint'
        ? (raw as { toJSON?: unknown }).toJSON
        : undefined
    const value = typeof toJSON === 'function' ? toJSON.call(raw, key) : raw
    if (value instanceof Number) return Number(value)
    if (value instanceof String) return String(value)
    if (value instanceof Boolean || value instanceof BigInt) return value.valueOf()
    return value
  }

  const isOmitted = (item: unknown): boolean =>
    item === undefined || typeof item === 'function' || typeof item === 'symbol'

  const visit = (item: unknown): void => {
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
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        if (index > 0) add(1)
        visit(resolve(item[index], String(index)))
      }
    } else {
      let written = 0
      for (const [key, raw] of Object.entries(item)) {
        const entry = resolve(raw, key)
        if (isOmitted(entry)) continue
        if (written > 0) add(1)
        written++
        addString(key)
        add(1)
        visit(entry)
      }
    }
    ancestors.delete(item)
  }

  try {
    visit(resolve(value, ''))
    return bytes
  } catch (error) {
    if (getErrorMessage(error) === 'json_size_limit_reached') {
      return maxBytes + 1
    }
    return undefined
  }
}
