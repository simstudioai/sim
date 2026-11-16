/**
 * `workflow.code_meta`: the server-side half of the lock (build-spec decision 6). It keeps the
 * facts a source file carries that the stored graph does not (each block's `const` identifier,
 * its declaration order, and comments) so they survive edits made only on the canvas and prints
 * that have no repo lock.
 *
 * Everything is keyed by **block id**, never by block key, so a canvas rename never orphans an
 * entry. Comment anchors use `encodeAnchor` with the block segment holding the block id and the
 * `var` segment holding the variable id; `header`, `wiring` and `footer` carry no id.
 *
 * Branch keys are not stored here: they persist on the condition/router rows themselves as the
 * optional row `key` (s1 D2b), which canonicalize already reads.
 *
 * Version policy matches the lock's: adding an optional field does not bump `v`; until every
 * reader knows a field, data goes under an `x-` key, which the validator tolerates and preserves.
 */

import type { LockExtensionKey } from './lock'
import type { AnchorKey, CodeComment, Json } from './model'

export interface WorkflowCodeMetaV1 {
  [extension: LockExtensionKey]: Json
  v: 1
  /** Block id → the TS `const` identifier it prints as. Never in `SDK_RESERVED_IDENTIFIERS`. */
  bindings: Record<string, string>
  /** Block id → print-order tie-break (a non-negative integer; not unique, like the lock's). */
  order: Record<string, number>
  /** Comments by id-anchored `AnchorKey`, in source order. */
  comments: Partial<Record<AnchorKey, CodeComment[]>>
}
