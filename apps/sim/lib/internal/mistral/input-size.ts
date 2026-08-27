function stringBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8') + 2
}

function countBytes(value: unknown, limit: number, seen: Set<object>): number {
  if (value === null) return 4
  if (typeof value === 'string') return stringBytes(value)
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).length : 4
  if (typeof value === 'bigint') throw new TypeError('Do not know how to serialize a BigInt')
  if (value instanceof Date) return stringBytes(value.toJSON())
  if (!value || typeof value !== 'object') return 0
  if (seen.has(value)) throw new TypeError('Converting circular structure to JSON')
  seen.add(value)

  let bytes = 2
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) bytes += 1
      bytes += countBytes(value[index], limit - bytes, seen)
      if (bytes > limit) break
    }
  } else {
    let emitted = false
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue
      if (emitted) bytes += 1
      bytes += stringBytes(key) + 1 + countBytes(entry, limit - bytes, seen)
      emitted = true
      if (bytes > limit) break
    }
  }
  seen.delete(value)
  return bytes
}

export function isMistralInputWithinLimit(input: unknown, limit: number): boolean {
  return countBytes(input, limit, new Set()) <= limit
}
