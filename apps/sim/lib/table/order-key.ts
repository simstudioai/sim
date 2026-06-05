/**
 * Fractional order keys for table-row ordering.
 *
 * A row's order is a base-62 string key, not an integer position. Inserting
 * between two rows mints a key strictly between their keys, so no other row's
 * key changes — insert and delete become O(1) (no position reshift / recompact).
 *
 * Thin wrapper over `fractional-indexing` (Figma/rocicorp algorithm) so the
 * implementation is swappable. Keys never run out (variable-length strings);
 * the only cost is gradual length growth under repeated same-spot inserts.
 */

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * Returns a key that sorts strictly between `a` and `b`. Pass `null` for an open
 * end: `keyBetween(null, first)` prepends, `keyBetween(last, null)` appends,
 * `keyBetween(null, null)` is the first key in an empty table.
 *
 * @throws if `a >= b` (callers must pass ordered, distinct bounds)
 */
export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b)
}

/**
 * Returns `n` keys evenly spaced strictly between `a` and `b` (same open-end
 * semantics as {@link keyBetween}). Used for batch inserts and the backfill
 * (`nKeysBetween(null, null, count)` mints an ordered run for an empty range).
 */
export function nKeysBetween(a: string | null, b: string | null, n: number): string[] {
  return generateNKeysBetween(a, b, n)
}
