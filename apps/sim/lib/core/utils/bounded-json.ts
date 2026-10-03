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

/** Measures plain JSON iteratively without serialization, copying, or additional node/depth caps. */
export function isJsonWithinByteLimit(value: unknown, maxBytes: number): boolean {
  if (!Number.isFinite(maxBytes) || maxBytes < 0 || value === undefined) return false
  const invalid = Symbol('invalid JSON')
  const ancestors = new WeakSet<object>()
  const stack: {
    value: object
    entries: Generator<[string | null, unknown]>
    count: number
  }[] = []
  let bytes = 0
  const omitted = (item: unknown) =>
    item === undefined || typeof item === 'function' || typeof item === 'symbol'
  function* entries(container: object): Generator<[string | null, unknown]> {
    if (Array.isArray(container)) {
      const length = Object.getOwnPropertyDescriptor(container, 'length')?.value
      if (typeof length !== 'number') {
        yield [null, invalid]
        return
      }
      for (let index = 0; index < length; index++) {
        const field = Object.getOwnPropertyDescriptor(container, index)
        if (field && !('value' in field)) {
          yield [null, invalid]
          return
        }
        yield [null, omitted(field?.value) ? null : field?.value]
      }
    } else {
      for (const key in container) {
        const field = Object.getOwnPropertyDescriptor(container, key)
        if (!field?.enumerable) continue
        if (!('value' in field)) {
          yield [key, invalid]
          return
        }
        if (!omitted(field.value)) yield [key, field.value]
      }
    }
  }
  try {
    let item: unknown = value
    for (;;) {
      if (typeof item === 'string') {
        const count = quotedStringBytes(item, maxBytes - bytes)
        if (count === undefined) return false
        bytes += count
      } else if (item === null) bytes += 4
      else if (typeof item === 'number') bytes += Number.isFinite(item) ? String(item).length : 4
      else if (typeof item === 'boolean') bytes += item ? 4 : 5
      else if (typeof item === 'object') {
        if (ancestors.has(item)) return false
        const prototype = Object.getPrototypeOf(item)
        if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
          return false
        for (let owner: object | null = item; owner; owner = Object.getPrototypeOf(owner)) {
          const serializer = Object.getOwnPropertyDescriptor(owner, 'toJSON')
          if (!serializer) continue
          if (!('value' in serializer) || typeof serializer.value === 'function') return false
          break
        }
        bytes += 2
        ancestors.add(item)
        stack.push({ value: item, entries: entries(item), count: 0 })
      } else return false
      if (bytes > maxBytes) return false
      for (;;) {
        const frame = stack[stack.length - 1]
        if (!frame) return true
        const next = frame.entries.next()
        if (next.done) {
          ancestors.delete(frame.value)
          stack.pop()
          continue
        }
        if (frame.count++ > 0) bytes++
        const [key, child] = next.value
        if (key !== null) {
          const count = quotedStringBytes(key, maxBytes - bytes)
          if (count === undefined) return false
          bytes += count + 1
        }
        if (bytes > maxBytes) return false
        item = child
        break
      }
    }
  } catch {
    return false
  }
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
