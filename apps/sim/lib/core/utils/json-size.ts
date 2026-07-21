const JSON_SYNTAX_BYTES = {
  QUOTE: 1,
  COLON: 1,
  COMMA: 1,
  ARRAY_BRACKETS: 2,
  OBJECT_BRACES: 2,
  NULL: 4,
} as const

function getEscapedJsonStringByteLength(value: string, maxBytes: number): number {
  let bytes = JSON_SYNTAX_BYTES.QUOTE * 2
  if (bytes > maxBytes) return bytes

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      bytes += 2
    } else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2
    } else if (code < 0x20) {
      bytes += 6
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index++
      } else {
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else {
      bytes += 3
    }

    if (bytes > maxBytes) return bytes
  }

  return bytes
}

function getPrimitiveJsonByteLength(value: unknown, maxBytes: number): number | undefined {
  if (value === null) {
    return JSON_SYNTAX_BYTES.NULL
  }
  if (typeof value === 'string') {
    return getEscapedJsonStringByteLength(value, maxBytes)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? Buffer.byteLength(String(value), 'utf8')
      : JSON_SYNTAX_BYTES.NULL
  }
  if (typeof value === 'boolean') {
    return value ? 4 : 5
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt')
  }
  return undefined
}

/**
 * Counts the UTF-8 bytes JSON serialization would require, stopping as soon as
 * the result exceeds `maxBytes` without allocating the complete JSON string.
 */
export function getBoundedJsonByteLength(
  value: unknown,
  maxBytes: number,
  seen = new WeakSet<object>()
): number | undefined {
  const primitiveSize = getPrimitiveJsonByteLength(value, maxBytes)
  if (primitiveSize !== undefined) {
    return primitiveSize
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  if (seen.has(value)) {
    throw new TypeError('Converting circular structure to JSON')
  }
  seen.add(value)

  let bytes = Array.isArray(value)
    ? JSON_SYNTAX_BYTES.ARRAY_BRACKETS
    : JSON_SYNTAX_BYTES.OBJECT_BRACES
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (index > 0) bytes += JSON_SYNTAX_BYTES.COMMA
      const itemSize = getBoundedJsonByteLength(value[index], maxBytes - bytes, seen)
      bytes += itemSize ?? JSON_SYNTAX_BYTES.NULL
      if (bytes > maxBytes) return bytes
    }
    seen.delete(value)
    return bytes
  }

  let hasEntries = false
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    const entryValue = (value as Record<string, unknown>)[key]
    if (
      entryValue === undefined ||
      typeof entryValue === 'function' ||
      typeof entryValue === 'symbol'
    ) {
      continue
    }
    if (hasEntries) bytes += JSON_SYNTAX_BYTES.COMMA
    bytes += getEscapedJsonStringByteLength(key, maxBytes - bytes) + JSON_SYNTAX_BYTES.COLON
    const entrySize = getBoundedJsonByteLength(entryValue, maxBytes - bytes, seen)
    bytes += entrySize ?? JSON_SYNTAX_BYTES.NULL
    hasEntries = true
    if (bytes > maxBytes) return bytes
  }

  seen.delete(value)
  return bytes
}
