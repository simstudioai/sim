const MAX_JSON_NODES = 100_000
const MAX_JSON_DEPTH = 64

/** Counts JSON escapes without allocating the escaped string. */
function quotedStringBytes(value: string, remaining: number): number | undefined {
  let bytes = 2
  for (let index = 0; index < value.length && bytes <= remaining; index++) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) bytes += 2
    else if (code < 0x20) bytes += (code >= 8 && code <= 10) || code === 12 || code === 13 ? 2 : 6
    else if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index++
      } else bytes += 6
    } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3
  }
  return bytes <= remaining ? bytes : undefined
}

/** Captures bounded plain JSON once, without executing accessors or serializing the source graph. */
export function stringifyBoundedJson(value: unknown, maxBytes: number): string | undefined {
  let nodes = 0
  let bytes = 0
  const invalid = Symbol('invalid JSON')
  const ancestors = new WeakSet<object>()
  const addBytes = (count: number): boolean => {
    bytes += count
    return bytes <= maxBytes
  }
  const capture = (item: unknown, depth: number): unknown => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return invalid
    if (typeof item === 'string') {
      const count = quotedStringBytes(item, maxBytes - bytes)
      if (count === undefined || !addBytes(count)) return invalid
      return item
    }
    if (item === null || item === undefined) return addBytes(4) ? item : invalid
    if (typeof item === 'number')
      return addBytes(Number.isFinite(item) ? String(item).length : 4) ? item : invalid
    if (typeof item === 'boolean') return addBytes(item ? 4 : 5) ? item : invalid
    if (typeof item !== 'object' || ancestors.has(item) || 'toJSON' in item) return invalid
    const prototype = Object.getPrototypeOf(item)
    const isArray = Array.isArray(item)
    if (!isArray && prototype !== Object.prototype && prototype !== null) return invalid
    if (!addBytes(2)) return invalid
    ancestors.add(item)
    const snapshot: Record<string, unknown> | unknown[] = isArray
      ? Object.setPrototypeOf([], null)
      : Object.create(null)
    if (isArray) {
      const length = Object.getOwnPropertyDescriptor(item, 'length')?.value
      if (typeof length !== 'number' || length > MAX_JSON_NODES - nodes) return invalid
      for (let index = 0; index < length; index++) {
        const field = Object.getOwnPropertyDescriptor(item, index)
        if (field && !('value' in field)) return invalid
        if (index > 0 && !addBytes(1)) return invalid
        const captured = capture(field?.value ?? null, depth + 1)
        if (captured === invalid) return invalid
        Object.defineProperty(snapshot, index, { value: captured, enumerable: true })
      }
    } else {
      let fields = 0
      for (const key in item) {
        const field = Object.getOwnPropertyDescriptor(item, key)
        if (!field || !field.enumerable) continue
        if (!('value' in field)) return invalid
        if (field.value === undefined) {
          if (++nodes > MAX_JSON_NODES) return invalid
          continue
        }
        const keyBytes = quotedStringBytes(key, maxBytes - bytes)
        if (keyBytes === undefined || !addBytes(keyBytes + 1 + (fields++ > 0 ? 1 : 0)))
          return invalid
        const captured = capture(field.value, depth + 1)
        if (captured === invalid) return invalid
        Object.defineProperty(snapshot, key, { value: captured, enumerable: true })
      }
    }
    ancestors.delete(item)
    return snapshot
  }
  try {
    const snapshot = capture(value, 0)
    return snapshot === invalid ? undefined : JSON.stringify(snapshot)
  } catch {
    return undefined
  }
}
