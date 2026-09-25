/**
 * Response fields that state the server itself clipped what it returned.
 *
 * Matched by shape rather than listed per command, so a flag added to a route
 * envelope is surfaced the day it lands. Structured list output carries data
 * and nextCursor along with these boolean flags; human-readable warnings remain on stderr.
 */
const TRUNCATION_FLAG = /^truncated$|^[A-Za-z0-9]+Truncated$/

/**
 * Negating prefixes whose `Truncated` suffix states the opposite.
 *
 * A bare `Truncated$` match also accepts `notTruncated` and `isNotTruncated`,
 * where `true` means the answer is whole, and a note about a clip that did not
 * happen is the worst thing this can print. These four prefixes are the
 * spellings worth anticipating rather than a decision procedure for English —
 * a field negated some other way slips through and has to be added here.
 */
const NEGATED_TRUNCATION_FLAG = /^(?:not|un|non|never)Truncated$|(?:Not|Un|Non|Never)Truncated$/

export function isTruncationField(key: string): boolean {
  return TRUNCATION_FLAG.test(key) && !NEGATED_TRUNCATION_FLAG.test(key)
}

/** Preserves declared boolean truncation fields without projecting user-owned row values. */
export function truncationMetadata(container: unknown): Record<string, boolean> {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return {}
  const metadata: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(container))
    if (typeof value === 'boolean' && isTruncationField(key)) metadata[key] = value
  return metadata
}
