/**
 * Fractional order keys for table-row ordering.
 *
 * A row's order is a base-62 string key, not an integer position. Inserting
 * between two rows mints a key strictly between their keys, so no other row's
 * key changes — insert and delete become O(1) (no position reshift / recompact).
 *
 * Thin wrapper over the in-house fractional-indexing port (Figma/rocicorp
 * algorithm) so the implementation is swappable. Keys never run out
 * (variable-length strings); the only cost is gradual length growth under
 * repeated same-spot inserts.
 */

import { generateKeyBetween, generateNKeysBetween } from '@sim/utils/fractional-indexing'
import { generateRandomBytes } from '@sim/utils/random'

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

/** Random halvings {@link appendKeys} takes: two concurrent appends collide with odds 2^-32. */
const APPEND_SLOT_BITS = 32

/**
 * Returns `n` ordered keys after `last`, in a slot no concurrent append to the same table picks.
 *
 * Appends take no lock, so two writers can read the same `last`. Each mints inside the integer
 * range `keyBetween(last, null)` opens, narrowed by {@link APPEND_SLOT_BITS} random halvings to a
 * private sub-range: keys never collide, and a batch stays contiguous instead of interleaving with
 * another writer's. The next append reads the new max and moves to the next integer, so keys do
 * not grow across appends — each carries a fixed few extra characters.
 */
export function appendKeys(last: string | null, n: number): string[] {
  let lo = keyBetween(last, null)
  let hi = keyBetween(lo, null)
  const bits = generateRandomBytes(APPEND_SLOT_BITS / 8)
  for (let i = 0; i < APPEND_SLOT_BITS; i++) {
    const mid = keyBetween(lo, hi)
    if ((bits[i >> 3] >> (i & 7)) & 1) lo = mid
    else hi = mid
  }
  return nKeysBetween(lo, hi, n)
}
