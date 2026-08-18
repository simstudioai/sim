import { asOrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Outcome of one item in a best-effort batch.
 *
 * `not_found`, `forbidden`, and `unauthorized` collapse into `notFound` so a
 * caller cannot use a bulk request to probe which identifiers exist in a
 * workspace it can see but may not write to — the same concealment the
 * single-item operations apply. Anything the orchestration layer did not
 * classify (or classified `internal`) ends the batch: it is an infrastructure
 * failure, not a per-item verdict.
 */
export type BulkItemDisposition =
  | { kind: 'notFound' }
  | { kind: 'failed'; reason: string }
  | { kind: 'terminal'; error: unknown }

/**
 * A domain's chance to rule on an error the shared classification cannot see.
 * Return `undefined` to defer to the shared rules.
 *
 * Only for errors that are genuinely a per-item verdict and carry no
 * orchestration code — a table's delete lock is the motivating case. A hook
 * must never widen `notFound` into a distinguishable outcome, or it reopens the
 * probe the concealment closes.
 */
export type BulkItemVerdict = (error: unknown) => BulkItemDisposition | undefined

/**
 * Classifies one item's error in a best-effort batch. One implementation for
 * every domain, so the concealment rule above cannot drift between them.
 */
export function classifyBulkItemError(
  error: unknown,
  verdict?: BulkItemVerdict
): BulkItemDisposition {
  const classified = asOrchestrationError(error)
  /**
   * Concealment is decided BEFORE the domain hook runs, so no hook can widen a
   * concealed code back into a distinguishable outcome. A hook exists for
   * errors the orchestration layer never classified at all.
   */
  if (
    classified?.code === 'not_found' ||
    classified?.code === 'forbidden' ||
    classified?.code === 'unauthorized'
  ) {
    return { kind: 'notFound' }
  }

  const domainVerdict = verdict?.(error)
  if (domainVerdict) return domainVerdict

  if (classified && classified.code !== 'internal') {
    return { kind: 'failed', reason: classified.message }
  }
  return { kind: 'terminal', error }
}
