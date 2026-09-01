function jsonStringBytes(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2
    } else if (code <= 0x1f) {
      bytes += 6
    } else if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

function primitiveJsonBytes(value: unknown): number | null {
  if (value === null) return 4
  switch (typeof value) {
    case 'string':
      return jsonStringBytes(value)
    case 'boolean':
      return value ? 4 : 5
    case 'number':
      return Number.isFinite(value) ? String(value).length : 4
    case 'bigint':
      throw new TypeError('Do not know how to serialize a BigInt')
    case 'undefined':
    case 'function':
    case 'symbol':
      return null
    default:
      return null
  }
}

function addJsonBytes(
  value: unknown,
  limit: number,
  seen: Set<object>,
  arrayEntry = false
): number {
  const primitiveBytes = primitiveJsonBytes(value)
  if (primitiveBytes !== null) return primitiveBytes
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return arrayEntry ? 4 : 0
  }
  if (value instanceof Date) return jsonStringBytes(value.toJSON())
  if (!value || typeof value !== 'object') return 0
  if (seen.has(value)) throw new TypeError('Converting circular structure to JSON')
  seen.add(value)

  let bytes = 2
  let emitted = false
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (emitted) bytes += 1
      bytes += addJsonBytes(entry, limit - bytes, seen, true)
      emitted = true
      if (bytes > limit) break
    }
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const entryBytes = addJsonBytes(entry, limit - bytes, seen)
      if (
        entryBytes === 0 &&
        (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol')
      ) {
        continue
      }
      if (emitted) bytes += 1
      bytes += jsonStringBytes(key) + 1 + entryBytes
      emitted = true
      if (bytes > limit) break
    }
  }
  seen.delete(value)
  return bytes
}

export function isJsonInputWithinLimit(input: unknown, limit: number): boolean {
  return addJsonBytes(input, limit, new Set()) <= limit
}
