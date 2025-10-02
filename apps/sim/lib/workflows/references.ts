import { normalizeBlockName } from '@/stores/workflows/utils'

export const SYSTEM_REFERENCE_PREFIXES = new Set(['start', 'loop', 'parallel', 'variable'])

const INVALID_REFERENCE_CHARS = /[+*/=<>!]/

export function isLikelyReferenceSegment(segment: string): boolean {
  if (!segment.startsWith('<') || !segment.endsWith('>')) {
    return false
  }

  const inner = segment.slice(1, -1)

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
    if (!isLikelyReferenceSegment(match)) {
      continue
    }

    const inner = match.slice(1, -1)
    const [rawPrefix] = inner.split('.')
    if (!rawPrefix) {
      continue
    }

    const normalized = normalizeBlockName(rawPrefix)
    references.push({ raw: match, prefix: normalized })
  }

  return references
}
