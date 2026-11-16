import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'

/**
 * Exact structural differences between two JSON-like values, reported as RFC 6901 paths so a
 * corpus report names the field that drifted instead of dumping two whole workflows.
 */

/** One place two values disagree. Previews are truncated JSON, for reports only. */
export interface Difference {
  /** RFC 6901 pointer into the expected value; `''` is the root. */
  path: string
  kind: 'missing' | 'unexpected' | 'type' | 'value' | 'length' | 'text'
  expected?: string
  actual?: string
}

const PREVIEW_LIMIT = 160

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function preview(value: unknown): string {
  let text: string
  if (value === undefined) text = 'undefined'
  else if (typeof value === 'string') text = JSON.stringify(value)
  else if (typeof value === 'number' && !Number.isFinite(value)) text = String(value)
  else {
    try {
      text = JSON.stringify(value) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  return truncate(text, PREVIEW_LIMIT, '…')
}

function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Every difference between `expected` and `actual`, up to `limit`. Exact: primitives compare with
 * `Object.is`, arrays compare in order, and an own key holding `undefined` differs from an absent
 * key. Object key order is ignored (Postgres `jsonb` does not keep it).
 */
export function findDifferences(expected: unknown, actual: unknown, limit = 20): Difference[] {
  const out: Difference[] = []

  const walk = (a: unknown, b: unknown, path: string): void => {
    if (out.length >= limit) return
    if (Object.is(a, b)) return

    const kindA = kindOf(a)
    const kindB = kindOf(b)
    if (kindA !== kindB) {
      out.push({ path, kind: 'type', expected: preview(a), actual: preview(b) })
      return
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        out.push({ path, kind: 'length', expected: String(a.length), actual: String(b.length) })
      }
      const shared = Math.min(a.length, b.length)
      for (let i = 0; i < shared; i++) walk(a[i], b[i], `${path}/${i}`)
      return
    }

    if (isRecordLike(a) && isRecordLike(b)) {
      for (const key of Object.keys(a)) {
        const childPath = `${path}/${escapePointerSegment(key)}`
        if (!Object.hasOwn(b, key)) {
          if (out.length < limit)
            out.push({ path: childPath, kind: 'missing', expected: preview(a[key]) })
          continue
        }
        walk(a[key], b[key], childPath)
      }
      for (const key of Object.keys(b)) {
        if (out.length >= limit) return
        if (!Object.hasOwn(a, key)) {
          out.push({
            path: `${path}/${escapePointerSegment(key)}`,
            kind: 'unexpected',
            actual: preview(b[key]),
          })
        }
      }
      return
    }

    out.push({ path, kind: 'value', expected: preview(a), actual: preview(b) })
  }

  walk(expected, actual, '')
  return out
}

/**
 * The first line where two texts differ, or `null` when they are identical. Used for printer
 * idempotence (P3), where the whole file is one string.
 */
export function firstTextDifference(expected: string, actual: string): Difference | null {
  if (expected === actual) return null
  const expectedLines = expected.split('\n')
  const actualLines = actual.split('\n')
  const count = Math.max(expectedLines.length, actualLines.length)
  for (let i = 0; i < count; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      return {
        path: `line:${i + 1}`,
        kind: 'text',
        expected: preview(expectedLines[i]),
        actual: preview(actualLines[i]),
      }
    }
  }
  return {
    path: 'eof',
    kind: 'text',
    expected: preview(expected.length),
    actual: preview(actual.length),
  }
}
