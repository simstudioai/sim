const MAX_MEMORY_JSON_NODES = 100_000
const MAX_MEMORY_JSON_DEPTH = 64

/** Rejects oversized or unsafe plain JSON before allocating its serialized representation. */
export function stringifyBoundedMemoryJson(value: unknown, maxBytes: number): string | undefined {
  let nodes = 0
  let minimumBytes = 0
  const ancestors = new WeakSet<object>()
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > MAX_MEMORY_JSON_NODES || depth > MAX_MEMORY_JSON_DEPTH) return false
    if (typeof item === 'string') minimumBytes += Buffer.byteLength(item, 'utf8') + 2
    else if (item === null || item === undefined) minimumBytes += 4
    else if (typeof item === 'number')
      minimumBytes += Number.isFinite(item) ? String(item).length : 4
    else if (typeof item === 'boolean') minimumBytes += item ? 4 : 5
    else if (typeof item !== 'object') return false
    else {
      if (ancestors.has(item) || 'toJSON' in item) return false
      const prototype = Object.getPrototypeOf(item)
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return false
      ancestors.add(item)
      minimumBytes += 2
      if (Array.isArray(item)) {
        if (item.length > MAX_MEMORY_JSON_NODES - nodes) return false
        for (let index = 0; index < item.length; index++) {
          const field = Object.getOwnPropertyDescriptor(item, index)
          if (field && !('value' in field)) return false
          if (index > 0) minimumBytes++
          if (!visit(field?.value, depth + 1)) return false
        }
      } else {
        let fields = 0
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue
          const field = Object.getOwnPropertyDescriptor(item, key)
          if (!field || !('value' in field)) return false
          if (fields++ > 0) minimumBytes++
          minimumBytes += Buffer.byteLength(key, 'utf8') + 3
          if (!visit(field.value, depth + 1)) return false
        }
      }
      ancestors.delete(item)
    }
    return minimumBytes <= maxBytes
  }
  try {
    if (!visit(value, 0)) return undefined
    const json = JSON.stringify(value)
    return json !== undefined && Buffer.byteLength(json, 'utf8') <= maxBytes ? json : undefined
  } catch {
    return undefined
  }
}
