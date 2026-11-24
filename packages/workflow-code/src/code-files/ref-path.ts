/**
 * The exact, two-way mapping between a stored reference path (`a.items[0].some-field`) and a JS
 * member chain (`a.items[0]['some-field']`), shared by workflow sources and
 * function code files.
 *
 * A stored path is `name ( '.' name | '[' index ']' )*`. A dot segment that is a JS identifier
 * maps to `.seg`, any other dot segment to `['seg']`, and a bracket index to `[n]`, so
 * `<a.items.0>` ↔ `a.items['0']` and `<a.items[0]>` ↔ `a.items[0]` stay distinct
 * (`splitLeadingBracketPath`, executor/variables/resolvers/reference.ts). Paths outside this
 * grammar are not mapped at all: callers keep them as literal text, which is exact.
 */

/** One segment of a stored reference path: a dot name or a bracket index. */
export type RefSegment = { kind: 'name'; name: string } | { kind: 'index'; index: number }

/**
 * Characters a mappable name segment may not contain: the path delimiters, the reference
 * brackets, whitespace, quotes and backslash (so `['seg']` never needs escaping), and the
 * operator characters that make the runtime reject a token as a reference
 * (`INVALID_REFERENCE_CHARS`, packages/utils/src/workflow-references.ts).
 */
const NAME_SEGMENT = /^[^.[\]<>\s'"`\\+*/=!&|{}]+$/
const CANONICAL_INDEX = /^(0|[1-9][0-9]{0,14})$/
const IDENTIFIER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** `PATTERNS.ENV_VAR_NAME` (apps/sim/executor/constants.ts). */
export const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The params a loop exposes to its children (executor/variables/resolvers/loop.ts). */
export const LOOP_PROPERTIES: readonly string[] = [
  'index',
  'currentItem',
  'items',
  'iteration',
  'item',
]
/** The params a parallel exposes to its children (executor/variables/resolvers/parallel.ts). */
export const PARALLEL_PROPERTIES: readonly string[] = ['index', 'currentItem', 'items']

/** An ASCII identifier name: usable as a bare object key or after `.` (reserved words included). */
export function isIdentifierName(text: string): boolean {
  return IDENTIFIER_NAME.test(text)
}

/** Whether `value` can be a name segment of a mappable path. */
export function isNameSegment(value: string): boolean {
  return NAME_SEGMENT.test(value)
}

/** Whether `value` can be a bracket index of a mappable path: a canonical non-negative integer. */
export function isIndexSegment(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && CANONICAL_INDEX.test(String(value))
}

/** Parses a stored path (the text between `<` and `>`), or `null` when it is outside the grammar. */
export function parseStoredPath(inner: string): RefSegment[] | null {
  const segments: RefSegment[] = []
  let cursor = 0
  const readName = (): string | null => {
    let end = cursor
    while (end < inner.length && inner[end] !== '.' && inner[end] !== '[') end++
    const name = inner.slice(cursor, end)
    if (!isNameSegment(name)) return null
    cursor = end
    return name
  }

  const head = readName()
  if (head === null) return null
  segments.push({ kind: 'name', name: head })

  while (cursor < inner.length) {
    if (inner[cursor] === '.') {
      cursor++
      const name = readName()
      if (name === null) return null
      segments.push({ kind: 'name', name })
      continue
    }
    if (inner[cursor] !== '[') return null
    const close = inner.indexOf(']', cursor)
    if (close === -1) return null
    const digits = inner.slice(cursor + 1, close)
    if (!CANONICAL_INDEX.test(digits)) return null
    segments.push({ kind: 'index', index: Number(digits) })
    cursor = close + 1
  }
  return segments
}

/** The stored spelling of a path, without the angle brackets. */
export function formatStoredPath(segments: readonly RefSegment[]): string {
  let text = ''
  for (const [position, segment] of segments.entries()) {
    if (segment.kind === 'index') {
      text += `[${segment.index}]`
    } else {
      text += position === 0 ? segment.name : `.${segment.name}`
    }
  }
  return text
}

/** A JS member chain rooted at `root`, one member per segment. */
export function formatMemberPath(root: string, segments: readonly RefSegment[]): string {
  let text = root
  for (const segment of segments) {
    if (segment.kind === 'index') {
      text += `[${segment.index}]`
    } else if (isIdentifierName(segment.name)) {
      text += `.${segment.name}`
    } else {
      text += `['${segment.name}']`
    }
  }
  return text
}
