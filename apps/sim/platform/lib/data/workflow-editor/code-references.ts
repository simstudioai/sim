import {
  isLikelyReferenceSegment,
  SYSTEM_REFERENCE_PREFIXES,
  splitReferenceSegment,
} from '@/lib/workflows/sanitization/references'
import { normalizeName } from '@/executor/constants'

/**
 * Whether a `<...>` segment in code reads as a reference the block can reach: a system prefix
 * (loop, parallel, variable) or a block upstream of it. With no reachability known, every
 * well-formed reference counts.
 */
export function isAccessibleCodeReference(
  part: string,
  accessiblePrefixes: Set<string> | undefined
): boolean {
  if (!part.startsWith('<') || !part.endsWith('>')) return false
  if (!isLikelyReferenceSegment(part)) return false
  const split = splitReferenceSegment(part)
  if (!split) return false
  if (!accessiblePrefixes) return true
  const [prefix] = split.reference.slice(1, -1).split('.')
  const normalizedPrefix = normalizeName(prefix)
  return SYSTEM_REFERENCE_PREFIXES.has(normalizedPrefix) || accessiblePrefixes.has(normalizedPrefix)
}
