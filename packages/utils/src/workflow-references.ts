const REFERENCE_START = '<'
const REFERENCE_END = '>'
const REFERENCE_PATH_DELIMITER = '.'
const INVALID_REFERENCE_CHARS = /[+*/=<>!&|]/
const LEADING_REFERENCE_PATTERN = /^[<>=!\s]*$/
const ENV_REFERENCE_START = '{{'
const ENV_REFERENCE_PATTERN = /\{\{[^{}\r\n]+\}\}/g
const LIST_SEPARATOR = ','

export type WorkflowReferenceTokenKind = 'environment' | 'workflow'

export interface WorkflowReferenceToken {
  kind: WorkflowReferenceTokenKind
  value: string
  start: number
  end: number
}

/** Separates comparison characters before the final `<workflow.reference>` segment. */
export function splitWorkflowReferenceSegment(
  segment: string
): { leading: string; reference: string } | null {
  if (!segment.startsWith(REFERENCE_START) || !segment.endsWith(REFERENCE_END)) return null

  const lastOpenBracket = segment.lastIndexOf(REFERENCE_START)
  if (lastOpenBracket === -1) return null

  const leading = lastOpenBracket > 0 ? segment.slice(0, lastOpenBracket) : ''
  const reference = segment.slice(lastOpenBracket)
  if (!reference.startsWith(REFERENCE_START) || !reference.endsWith(REFERENCE_END)) return null

  return { leading, reference }
}

/** Distinguishes Sim workflow references from comparison expressions and stray angle brackets. */
export function isLikelyWorkflowReferenceSegment(segment: string): boolean {
  const split = splitWorkflowReferenceSegment(segment)
  if (!split) return false

  const { leading, reference } = split
  if (leading && !LEADING_REFERENCE_PATTERN.test(leading)) return false

  const inner = reference.slice(REFERENCE_START.length, -REFERENCE_END.length)
  if (!inner || inner.startsWith(' ')) return false
  if (/^\s*[<>=!]+\s*$/.test(inner) || /\s[<>=!]+\s/.test(inner)) return false
  if (/^[<>=!]+\s/.test(inner)) return false

  const dotIndex = inner.indexOf(REFERENCE_PATH_DELIMITER)
  if (dotIndex !== -1) {
    const beforeDot = inner.slice(0, dotIndex)
    const afterDot = inner.slice(dotIndex + REFERENCE_PATH_DELIMITER.length)
    return (
      !afterDot.includes(' ') &&
      !INVALID_REFERENCE_CHARS.test(beforeDot) &&
      !INVALID_REFERENCE_CHARS.test(afterDot)
    )
  }

  return !INVALID_REFERENCE_CHARS.test(inner) && !/^\d+$/.test(inner) && !/\s\d/.test(inner)
}

/**
 * Calls `onReference` with the `[start, end)` span of every `<workflow.reference>` candidate, in
 * source order. Spans never overlap each other, but may overlap an `{{ENV}}` placeholder.
 */
function scanWorkflowReferenceSpans(
  source: string,
  onReference: (start: number, end: number) => void
): void {
  let candidateStart = -1
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === REFERENCE_START && candidateStart === -1) {
      candidateStart = index
      continue
    }
    if (character === '\r' || character === '\n') {
      candidateStart = -1
      continue
    }
    if (character !== REFERENCE_END || candidateStart === -1) continue

    const candidate = source.slice(candidateStart, index + REFERENCE_END.length)
    const split = splitWorkflowReferenceSegment(candidate)
    if (split && isLikelyWorkflowReferenceSegment(candidate)) {
      const start = candidateStart + split.leading.length
      onReference(start, start + split.reference.length)
    }
    candidateStart = -1
  }
}

/** Finds non-overlapping `{{ENV}}` and `<workflow.reference>` tokens in source order. */
export function findWorkflowReferenceTokens(source: string): WorkflowReferenceToken[] {
  const environmentTokens: WorkflowReferenceToken[] = []
  for (const match of source.matchAll(ENV_REFERENCE_PATTERN)) {
    const start = match.index
    environmentTokens.push({
      kind: 'environment',
      value: match[0],
      start,
      end: start + match[0].length,
    })
  }

  /**
   * Environment tokens are disjoint and ordered, and workflow spans arrive in increasing order, so
   * one forward cursor finds the only environment token a span can overlap - linear, where a scan
   * of every prior token per span is quadratic on reference-dense values.
   */
  const workflowTokens: WorkflowReferenceToken[] = []
  let environmentIndex = 0
  scanWorkflowReferenceSpans(source, (start, end) => {
    while (
      environmentIndex < environmentTokens.length &&
      environmentTokens[environmentIndex].end <= start
    ) {
      environmentIndex += 1
    }
    const next = environmentTokens[environmentIndex]
    if (next && next.start < end) return
    workflowTokens.push({ kind: 'workflow', value: source.slice(start, end), start, end })
  })

  return [...environmentTokens, ...workflowTokens].sort((left, right) => left.start - right.start)
}

/**
 * Splits a comma-separated list without tearing a reference apart.
 *
 * A `<block.path>` or `{{ENV_VAR}}` may itself contain a comma (`<start.pick(a,b)>`), so only a
 * comma outside every reference is a separator. Unlike {@link findWorkflowReferenceTokens}, a
 * `<...>` that wraps a placeholder (`<start.pick({{A}},b)>`) protects its whole span. Entries are
 * trimmed and empty entries dropped.
 */
export function splitOutsideWorkflowReferences(source: string): string[] {
  const protectedIndexes = new Uint8Array(source.length)
  const protect = (start: number, end: number) => {
    protectedIndexes.fill(1, start, end)
  }
  if (source.includes(ENV_REFERENCE_START)) {
    for (const match of source.matchAll(ENV_REFERENCE_PATTERN)) {
      protect(match.index, match.index + match[0].length)
    }
  }
  if (source.includes(REFERENCE_START)) {
    scanWorkflowReferenceSpans(source, protect)
  }

  const entries: string[] = []
  const pushEntry = (start: number, end: number) => {
    const entry = source.slice(start, end).trim()
    if (entry) entries.push(entry)
  }
  let entryStart = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === LIST_SEPARATOR && !protectedIndexes[index]) {
      pushEntry(entryStart, index)
      entryStart = index + 1
    }
  }
  pushEntry(entryStart, source.length)
  return entries
}
