import { deepEqual } from '../records'

/**
 * The id a lone key rename carries over to the item it renamed: exactly one item has no known id,
 * exactly one known id lost its key, and `continues(item, formerKey)` ties the two beyond their
 * type (see {@link sharesEvidence}). `null` otherwise, so an unrelated delete and add in one edit
 * stay a delete and an add, which the apply refuses without `allowDelete`.
 */
export function soleRename<I, K>(
  unmatched: readonly I[],
  orphans: ReadonlyArray<readonly [id: string, formerKey: K]>,
  continues: (item: I, formerKey: K) => boolean
): { item: I; id: string } | null {
  if (unmatched.length !== 1 || orphans.length !== 1) return null
  const [item] = unmatched
  const [[id, formerKey]] = orphans
  return continues(item, formerKey) ? { item, id } : null
}

/**
 * Whether `value` says something about the item that holds it: not absent, empty or blank, and
 * not a value as common as `0`, `false` or `true`, which two unrelated items often both hold.
 */
function isEvidence(value: unknown): boolean {
  if (value === undefined || value === null || typeof value === 'boolean' || value === 0) {
    return false
  }
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

/**
 * Whether two items (of one type: the caller checks it) are the same item under a new key: some
 * field of `fields` holds a value in either, and every such field is equal in both. A shared type
 * alone, or two empty values, ties nothing: `apiKey: string` removed and `region: string` added
 * are a delete and an add.
 */
export function sharesEvidence<T>(before: T, after: T, fields: ReadonlyArray<keyof T>): boolean {
  const held = fields.filter((field) => isEvidence(before[field]) || isEvidence(after[field]))
  return held.length > 0 && held.every((field) => deepEqual(before[field], after[field]))
}
