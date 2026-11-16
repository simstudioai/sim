/**
 * Equality and digests over the CWM. All three ignore `annotations` (DESIGN.md decision 3), the
 * key order of every object (jsonb does not keep it, s1 quirk 28) and the order of `edges`.
 */

import type { CanonicalEqualsFn, CanonicalHashFn, SourceFingerprintFn } from '../api'
import { compareEdges } from '../canonicalize/edges'
import type { BlockCatalog } from '../catalog/types'
import { sha256Hex, stableStringify } from '../hash'
import type { CanonicalWorkflow } from '../model'
import { executableView } from './executable'

/** The semantic part of a CWM: everything but annotations, with edges in canonical order. */
function semantic(workflow: CanonicalWorkflow) {
  return {
    modelVersion: workflow.modelVersion,
    meta: workflow.meta,
    blocks: workflow.blocks,
    edges: [...workflow.edges].sort(compareEdges),
    variables: workflow.variables,
  }
}

/** Defined own entries; an `undefined` field means the same as an absent one. */
function definedEntries(value: object): Array<[string, unknown]> {
  return Object.entries(value).filter(([, field]) => field !== undefined)
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => deepEqual(item, right[index]))
  }
  const leftEntries = definedEntries(left)
  const rightRecord = right as Record<string, unknown>
  if (leftEntries.length !== definedEntries(right).length) return false
  return leftEntries.every(
    ([key, field]) => Object.hasOwn(rightRecord, key) && deepEqual(field, rightRecord[key])
  )
}

/** Structural equality, total (never throws). */
export const canonicalEquals: CanonicalEqualsFn = (a, b) => deepEqual(semantic(a), semantic(b))

/** `sha256Hex(stableStringify(workflow minus annotations))`. Equal CWMs hash alike. */
export const canonicalHash: CanonicalHashFn = (workflow) =>
  sha256Hex(stableStringify(semantic(workflow)))

/**
 * `sf1:` + `sha256Hex(stableStringify({ workflow, identity }))` (build-spec decision 11). The CWM
 * part already carries variables and locked flags and has no layout, and the identity adds the
 * ids, so a canvas drag never changes it while any rename, re-id or edit does.
 */
export const sourceFingerprint: SourceFingerprintFn = (workflow, identity) =>
  `sf1:${sha256Hex(stableStringify({ workflow: semantic(workflow), identity }))}`

/**
 * Whether two workflows run the same: their executable views (`executable.ts`) are equal. P0 and
 * P1 hold under this; O1 still compares stored bytes.
 */
export function executableEquals(
  a: CanonicalWorkflow,
  b: CanonicalWorkflow,
  catalog: BlockCatalog
): boolean {
  return deepEqual(executableView(a, catalog), executableView(b, catalog))
}
