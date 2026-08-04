import { normalizeName, REFERENCE } from '@/executor/constants'

export const SYSTEM_REFERENCE_PREFIXES = new Set(['loop', 'parallel', 'variable'])

const INVALID_REFERENCE_CHARS = /[+*/=<>!]/

const LEADING_REFERENCE_PATTERN = /^[<>=!\s]*$/

export function splitReferenceSegment(
  segment: string
): { leading: string; reference: string } | null {
  if (!segment.startsWith(REFERENCE.START) || !segment.endsWith(REFERENCE.END)) {
    return null
  }

  const lastOpenBracket = segment.lastIndexOf(REFERENCE.START)
  if (lastOpenBracket === -1) {
    return null
  }

  const leading = lastOpenBracket > 0 ? segment.slice(0, lastOpenBracket) : ''
  const reference = segment.slice(lastOpenBracket)

  if (!reference.startsWith(REFERENCE.START) || !reference.endsWith(REFERENCE.END)) {
    return null
  }

  return { leading, reference }
}

export function isLikelyReferenceSegment(segment: string): boolean {
  const split = splitReferenceSegment(segment)
  if (!split) {
    return false
  }

  const { leading, reference } = split

  if (leading && !LEADING_REFERENCE_PATTERN.test(leading)) {
    return false
  }

  const inner = reference.slice(REFERENCE.START.length, -REFERENCE.END.length)

  if (!inner) {
    return false
  }

  if (inner.startsWith(' ')) {
    return false
  }

  if (inner.match(/^\s*[<>=!]+\s*$/) || inner.match(/\s[<>=!]+\s/)) {
    return false
  }

  if (inner.match(/^[<>=!]+\s/)) {
    return false
  }

  if (inner.includes(REFERENCE.PATH_DELIMITER)) {
    const dotIndex = inner.indexOf(REFERENCE.PATH_DELIMITER)
    const beforeDot = inner.substring(0, dotIndex)
    const afterDot = inner.substring(dotIndex + REFERENCE.PATH_DELIMITER.length)

    if (afterDot.includes(' ')) {
      return false
    }

    if (INVALID_REFERENCE_CHARS.test(beforeDot) || INVALID_REFERENCE_CHARS.test(afterDot)) {
      return false
    }
  } else if (INVALID_REFERENCE_CHARS.test(inner) || inner.match(/^\d+$/) || inner.match(/\s\d/)) {
    return false
  }

  return true
}

const ENV_VAR_PATTERN = new RegExp(`\\${REFERENCE.ENV_VAR_START}[^}]+\\${REFERENCE.ENV_VAR_END}`)

/**
 * Whether a subblock value carries a `<block.path>` / `<variable.name>` reference or a
 * `{{ENV_VAR}}` placeholder instead of a literal value — i.e. its real value is only known
 * once the workflow runs. Conditions that gate one field on a sibling's literal value use
 * this to stay visible while the sibling is bound dynamically.
 */
export function containsReference(value: unknown): boolean {
  if (typeof value !== 'string' || !value) {
    return false
  }
  return extractReferencePrefixes(value).length > 0 || ENV_VAR_PATTERN.test(value)
}

export function extractReferencePrefixes(value: string): Array<{ raw: string; prefix: string }> {
  if (!value || typeof value !== 'string') {
    return []
  }

  const referencePattern = new RegExp(`${REFERENCE.START}[^${REFERENCE.END}]+${REFERENCE.END}`, 'g')
  const matches = value.match(referencePattern)
  if (!matches) {
    return []
  }

  const references: Array<{ raw: string; prefix: string }> = []

  for (const match of matches) {
    const split = splitReferenceSegment(match)
    if (!split) {
      continue
    }

    if (split.leading && !LEADING_REFERENCE_PATTERN.test(split.leading)) {
      continue
    }

    const referenceSegment = split.reference

    if (!isLikelyReferenceSegment(referenceSegment)) {
      continue
    }

    const inner = referenceSegment.slice(REFERENCE.START.length, -REFERENCE.END.length)
    const [rawPrefix] = inner.split(REFERENCE.PATH_DELIMITER)
    if (!rawPrefix) {
      continue
    }

    const normalized = normalizeName(rawPrefix)
    references.push({ raw: referenceSegment, prefix: normalized })
  }

  return references
}
