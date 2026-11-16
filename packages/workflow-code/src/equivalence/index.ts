/**
 * Equality and digests over the CWM. All three ignore `annotations`, the
 * key order of every object (jsonb does not keep it) and the order of `edges`.
 */

import type { CanonicalEqualsFn, CanonicalHashFn, SourceFingerprintFn } from '../api'
import { compareEdges } from '../canonicalize/edges'
import { sha256Hex, stableStringify } from '../hash'
import type { CanonicalWorkflow } from '../model'
import { deepEqual } from '../records'

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

/** Structural equality, total (never throws). */
export const canonicalEquals: CanonicalEqualsFn = (a, b) => deepEqual(semantic(a), semantic(b))

/** `sha256Hex(stableStringify(workflow minus annotations))`. Equal CWMs hash alike. */
export const canonicalHash: CanonicalHashFn = (workflow) =>
  sha256Hex(stableStringify(semantic(workflow)))

/**
 * `sf1:` + `sha256Hex(stableStringify({ workflow, identity }))`. The CWM
 * part already carries variables and locked flags and has no layout, and the identity adds the
 * ids, so a canvas drag never changes it while any rename, re-id or edit does.
 */
export const sourceFingerprint: SourceFingerprintFn = (workflow, identity) =>
  `sf1:${sha256Hex(stableStringify({ workflow: semantic(workflow), identity }))}`
