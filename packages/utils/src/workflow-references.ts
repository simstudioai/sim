const REFERENCE_START = '<'
const REFERENCE_END = '>'
const REFERENCE_PATH_DELIMITER = '.'
const INVALID_REFERENCE_CHARS = /[+*/=<>!]/
const LEADING_REFERENCE_PATTERN = /^[<>=!\s]*$/
const ENV_REFERENCE_PATTERN = /\{\{[^{}\r\n]+\}\}/g
const ANGLE_REFERENCE_PATTERN = /<[^<>\r\n]+>/g

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

/** Finds non-overlapping `{{ENV}}` and `<workflow.reference>` tokens in source order. */
export function findWorkflowReferenceTokens(source: string): WorkflowReferenceToken[] {
  const tokens: WorkflowReferenceToken[] = []

  for (const match of source.matchAll(ENV_REFERENCE_PATTERN)) {
    const start = match.index
    tokens.push({ kind: 'environment', value: match[0], start, end: start + match[0].length })
  }

  for (const match of source.matchAll(ANGLE_REFERENCE_PATTERN)) {
    const start = match.index
    const end = start + match[0].length
    if (!isLikelyWorkflowReferenceSegment(match[0])) continue
    if (tokens.some((token) => start < token.end && end > token.start)) continue
    tokens.push({ kind: 'workflow', value: match[0], start, end })
  }

  return tokens.sort((left, right) => left.start - right.start)
}
