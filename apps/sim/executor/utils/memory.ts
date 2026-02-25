export type CompactOptions = {
  maxDepth: number
  maxStringLength: number
  maxArrayLength: number
  maxObjectKeys: number
}

const DEFAULT_COMPACT_OPTIONS: CompactOptions = {
  maxDepth: 6,
  maxStringLength: 4000,
  maxArrayLength: 50,
  maxObjectKeys: 100,
}

export function retainTailInPlace<T>(items: T[], maxItems: number): { dropped: number } {
  const max = Number.isFinite(maxItems) ? Math.max(0, Math.floor(maxItems)) : 0
  const dropped = items.length > max ? items.length - max : 0
  if (dropped > 0) {
    items.splice(0, dropped)
  }
  return { dropped }
}

export function compactValue(value: unknown, options?: Partial<CompactOptions>): unknown {
  const opts: CompactOptions = { ...DEFAULT_COMPACT_OPTIONS, ...(options ?? {}) }
  const seen = new WeakSet<object>()
  return compactValueInner(value, opts, 0, seen)
}

function compactValueInner(
  value: unknown,
  options: CompactOptions,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (value === null || value === undefined) return value

  const t = typeof value
  if (t === 'string') {
    if (value.length <= options.maxStringLength) return value
    const kept = value.slice(0, options.maxStringLength)
    return `${kept}... [truncated ${value.length - options.maxStringLength} chars]`
  }
  if (t === 'number' || t === 'boolean') return value
  if (t === 'bigint') return value.toString()
  if (t === 'symbol') return value.toString()
  if (t === 'function') return '[Function]'

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack:
        typeof value.stack === 'string'
          ? (compactValueInner(value.stack, options, depth + 1, seen) as string)
          : undefined,
    }
  }

  if (depth >= options.maxDepth) {
    return '[MaxDepth]'
  }

  if (Array.isArray(value)) {
    const out: unknown[] = []
    const limit = Math.max(0, options.maxArrayLength)
    const slice = value.slice(0, limit)
    for (const item of slice) {
      out.push(compactValueInner(item, options, depth + 1, seen))
    }
    if (value.length > limit) {
      out.push(`[... omitted ${value.length - limit} items]`)
    }
    return out
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)

    const entries = Object.entries(value as Record<string, unknown>)
    const limit = Math.max(0, options.maxObjectKeys)
    const out: Record<string, unknown> = {}
    for (const [key, val] of entries.slice(0, limit)) {
      out[key] = compactValueInner(val, options, depth + 1, seen)
    }
    if (entries.length > limit) {
      out.__omittedKeys = entries.length - limit
    }
    return out
  }

  try {
    return String(value)
  } catch {
    return '[Unserializable]'
  }
}
