/**
 * Equality and digests over the CWM. Each ignores `annotations`, the
 * key order of every object (jsonb does not keep it) and the order of `edges`.
 */

import { compareEdges } from '../canonicalize/edges'
import { sha256Hex, stableStringify } from '../hash'
import type { LockIdentity, SourceFingerprint } from '../lock'
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
export function canonicalEquals(a: CanonicalWorkflow, b: CanonicalWorkflow): boolean {
  return deepEqual(semantic(a), semantic(b))
}

/** `sha256Hex(stableStringify(workflow minus annotations))`. Equal CWMs hash alike. */
export function canonicalHash(workflow: CanonicalWorkflow): string {
  return sha256Hex(stableStringify(semantic(workflow)))
}

/**
 * The fingerprint over an already serialized semantic workflow: the bytes
 * `stableStringify({ workflow, identity })` writes, since `identity` sorts before `workflow`.
 */
function fingerprintOfSerialized(serialized: string, identity: LockIdentity): SourceFingerprint {
  return `sf1:${sha256Hex(`{"identity":${stableStringify(identity)},"workflow":${serialized}}`)}`
}

/**
 * `sf1:` + `sha256Hex(stableStringify({ workflow, identity }))`. The CWM
 * part already carries variables and locked flags and has no layout, and the identity adds the
 * ids, so a canvas drag never changes it while any rename, re-id or edit does.
 */
export function sourceFingerprint(
  workflow: CanonicalWorkflow,
  identity: LockIdentity
): SourceFingerprint {
  return fingerprintOfSerialized(stableStringify(semantic(workflow)), identity)
}

/**
 * {@link canonicalHash} and {@link sourceFingerprint} of one workflow, serializing it once.
 */
export function canonicalDigests(
  workflow: CanonicalWorkflow,
  identity: LockIdentity
): { canonicalHash: string; fingerprint: SourceFingerprint } {
  const serialized = stableStringify(semantic(workflow))
  return {
    canonicalHash: sha256Hex(serialized),
    fingerprint: fingerprintOfSerialized(serialized, identity),
  }
}
