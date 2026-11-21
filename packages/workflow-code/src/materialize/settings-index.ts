import { canonicalJson } from '@sim/utils/object'
import type { BlockKey, CanonicalBlock } from '../model'
import { pushTo, strings } from '../records'

/** Whether any string under `value` holds a `<`, the only way a reference can sit in it. */
function holdsAngle(value: unknown): boolean {
  for (const text of strings(value)) if (text.includes('<')) return true
  return false
}

/**
 * The blocks among `blocks` whose settings may agree with a given block's, a superset found
 * without comparing every pair, and the same whichever side is indexed. Settings agree only when
 * every param both blocks hold is equal (references to a renamed block's old key read as its new
 * one), so a match either lacks a param the given block holds or holds it equal. A value with no
 * `<` holds no reference, so the old-key rewrite leaves it as it is and equal values have equal
 * canonical JSON; a value with one keeps one after the rewrite, so it can only equal another such
 * value.
 *
 * A lookup walks only the param it narrows to: the blocks holding that param's value (its bucket)
 * and the blocks lacking the param, each list built once.
 */
export function settingsIndex(blocks: ReadonlyArray<[BlockKey, Pick<CanonicalBlock, 'params'>]>) {
  const byValue = new Map<string, BlockKey[]>()
  const holders = new Map<string, Set<BlockKey>>()
  const bucketOf = (id: string, value: unknown) =>
    holdsAngle(value) ? `<\u0000${id}` : `=\u0000${id}\u0000${canonicalJson(value)}`
  for (const [key, block] of blocks) {
    for (const [id, value] of Object.entries(block.params)) {
      pushTo(byValue, bucketOf(id, value), key)
      const held = holders.get(id)
      if (held) held.add(key)
      else holders.set(id, new Set([key]))
    }
  }
  const lacking = new Map<string, BlockKey[]>()
  const lackingOf = (id: string): BlockKey[] => {
    let keys = lacking.get(id)
    if (!keys) {
      const held = holders.get(id)
      keys = held
        ? blocks.flatMap(([key]) => (held.has(key) ? [] : [key]))
        : blocks.map(([key]) => key)
      lacking.set(id, keys)
    }
    return keys
  }
  return function* matches(block: Pick<CanonicalBlock, 'params'>): Generator<BlockKey> {
    let best: { id: string; equal: BlockKey[] } | undefined
    let bestSize = Number.POSITIVE_INFINITY
    for (const [id, value] of Object.entries(block.params)) {
      const equal = byValue.get(bucketOf(id, value)) ?? []
      const size = blocks.length - (holders.get(id)?.size ?? 0) + equal.length
      if (size < bestSize) {
        best = { id, equal }
        bestSize = size
      }
    }
    if (!best) return
    yield* lackingOf(best.id)
    yield* best.equal
  }
}
