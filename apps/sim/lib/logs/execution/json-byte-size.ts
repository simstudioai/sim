import { getErrorMessage } from '@sim/utils/errors'

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

  const visit = (item: unknown): void => {
    if (
      item === undefined ||
      item === null ||
      typeof item === 'function' ||
      typeof item === 'symbol'
    ) {
      add(4)
      return
    }
    if (typeof item === 'string') {
      add(Buffer.byteLength(JSON.stringify(item), 'utf8'))
      return
    }
    if (typeof item === 'bigint') {
      add(Buffer.byteLength(JSON.stringify(item.toString()), 'utf8'))
      return
    }
    if (typeof item === 'number' || typeof item === 'boolean') {
      add(Buffer.byteLength(JSON.stringify(item) ?? 'null', 'utf8'))
      return
    }
    if (ancestors.has(item)) {
      return
    }
    ancestors.add(item)

    if (Array.isArray(item)) {
      add(2)
      item.forEach((entry, index) => {
        if (index > 0) add(1)
        visit(entry)
      })
    } else {
      const entries = Object.entries(item)
      add(2)
      entries.forEach(([key, entry], index) => {
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') return
        if (index > 0) add(1)
        add(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1)
        visit(entry)
      })
    }
    ancestors.delete(item)
  }

  try {
    visit(value)
    return bytes
  } catch (error) {
    if (getErrorMessage(error) === 'json_size_limit_reached') {
      return maxBytes + 1
    }
    return undefined
  }
}
