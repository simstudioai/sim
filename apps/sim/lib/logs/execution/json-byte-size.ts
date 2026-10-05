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

  /** Applies `toJSON` the way `JSON.stringify` does before a value is written. */
  const resolve = (raw: unknown, key: string): unknown => {
    const toJSON =
      (typeof raw === 'object' && raw !== null) || typeof raw === 'bigint'
        ? (raw as { toJSON?: unknown }).toJSON
        : undefined
    return typeof toJSON === 'function' ? toJSON.call(raw, key) : raw
  }

  const isOmitted = (item: unknown): boolean =>
    item === undefined || typeof item === 'function' || typeof item === 'symbol'

  const visit = (item: unknown): void => {
    if (item === null || isOmitted(item)) {
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
        add(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1)
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
