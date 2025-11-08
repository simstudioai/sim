import { normalizeBlockName } from '@/stores/workflows/utils'

export const SYSTEM_REFERENCE_PREFIXES = new Set(['start', 'loop', 'parallel', 'variable'])

const INVALID_REFERENCE_CHARS = /[+*/=<>!]/

const LEADING_REFERENCE_PATTERN = /^[<>=!\s]*$/

export function splitReferenceSegment(
  segment: string
): { leading: string; reference: string } | null {
  if (!segment.startsWith('<') || !segment.endsWith('>')) {
    return null
  }

  const lastOpenBracket = segment.lastIndexOf('<')
  if (lastOpenBracket === -1) {
    return null
  }

  const leading = lastOpenBracket > 0 ? segment.slice(0, lastOpenBracket) : ''
  const reference = segment.slice(lastOpenBracket)

  if (!reference.startsWith('<') || !reference.endsWith('>')) {
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

  const inner = reference.slice(1, -1)

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

  if (inner.includes('.')) {
    const dotIndex = inner.indexOf('.')
    const beforeDot = inner.substring(0, dotIndex)
    const afterDot = inner.substring(dotIndex + 1)

    if (afterDot.includes(' ')) {
      return false
    }

    if (INVALID_REFERENCE_CHARS.test(beforeDot) || INVALID_REFERENCE_CHARS.test(afterDot)) {
      return false
    }
  } else if (INVALID_REFERENCE_CHARS.test(inner) || inner.match(/^\d/) || inner.match(/\s\d/)) {
    return false
  }

  return true
}

export function extractReferencePrefixes(value: string): Array<{ raw: string; prefix: string }> {
  if (!value || typeof value !== 'string') {
    return []
  }

  const matches = value.match(/<[^>]+>/g)
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

    const inner = referenceSegment.slice(1, -1)
    const [rawPrefix] = inner.split('.')
    if (!rawPrefix) {
      continue
    }

    const normalized = normalizeBlockName(rawPrefix)
    references.push({ raw: referenceSegment, prefix: normalized })
  }

  return references
}
