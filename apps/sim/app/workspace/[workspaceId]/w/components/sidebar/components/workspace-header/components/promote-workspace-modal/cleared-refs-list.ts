import type { ForkClearedRef } from '@/lib/api/contracts/workspace-fork'

/** Whether a resource is resolved by the current selection (mapped to a target OR selected for copy). */
export type ClearedRefResolvedPredicate = (kind: string, sourceId: string) => boolean

/**
 * Parent kinds whose dependent child is itself a resource carried alongside the parent, so
 * resolving the parent (mapping or copying it) PRESERVES the child rather than clearing it -
 * currently just knowledge bases: a referenced document is copied with its KB, or auto-copied into
 * a mapped KB, and remapped in place. Any other parent's child (a credential's label, a table's
 * column) is account/table-scoped and cleared whenever the parent is remapped (the engine's
 * `clearDependentsOnRemap`), so those entries stay regardless of the parent's disposition.
 */
const PARENT_KINDS_THAT_PRESERVE_CHILD: ReadonlySet<string> = new Set(['knowledge-base'])

/**
 * Narrow the diff's cleared-ref candidates to those still cleared under the live selection:
 *  - `reference`: drops off once its own resource is resolved (mapped or copied).
 *  - `dependent`: drops off once its PARENT resource (`parentKind`/`parentSourceId`) is resolved -
 *    using the SAME predicate as `reference` - but ONLY when the child follows that parent (a
 *    document under a KB). A credential- or table-anchored dependent is cleared on any parent
 *    remap, so it stays even after the parent is mapped. A dependent missing its parent stays.
 *  - `workflow`: always stays - a cross-workflow reference cannot be resolved in the modal.
 *
 * Pure so the reactive list is unit-testable independent of the modal's selection state.
 */
export function selectVisibleClearedRefs(
  clearedRefs: ForkClearedRef[],
  isResolved: ClearedRefResolvedPredicate
): ForkClearedRef[] {
  return clearedRefs.filter((ref) => {
    if (ref.cause === 'reference') return !isResolved(ref.kind, ref.sourceId)
    if (
      ref.cause === 'dependent' &&
      ref.parentKind &&
      ref.parentSourceId &&
      PARENT_KINDS_THAT_PRESERVE_CHILD.has(ref.parentKind)
    ) {
      return !isResolved(ref.parentKind, ref.parentSourceId)
    }
    return true
  })
}
