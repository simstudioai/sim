import type { ForkClearedRef } from '@/lib/api/contracts/workspace-fork'
import { forkSyncBlockerReasonFor } from '@/lib/workspaces/fork/promote/sync-blockers'

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
 *    document under a KB). A credential- or table-anchored dependent is cleared on any parent remap,
 *    so it stays even after the parent is mapped.
 *  - `workflow`: always stays - a cross-workflow reference cannot be resolved here.
 *
 * Pure so the reactive list is unit-testable independent of the page's selection state.
 */
export function selectVisibleClearedRefs(
  clearedRefs: ForkClearedRef[],
  isResolved: ClearedRefResolvedPredicate
): ForkClearedRef[] {
  return clearedRefs.filter((ref) => {
    if (ref.cause === 'reference') return !isResolved(ref.kind, ref.sourceId)
    // The discriminated union guarantees `parentKind`/`parentSourceId` on a `dependent` variant.
    if (ref.cause === 'dependent' && PARENT_KINDS_THAT_PRESERVE_CHILD.has(ref.parentKind)) {
      return !isResolved(ref.parentKind, ref.parentSourceId)
    }
    return true
  })
}

/**
 * Split the visible would-clear entries into sync BLOCKERS (cause `reference`/`workflow` - the
 * sync is disabled while any remain) and the informational remainder (`dependent` entries, owned
 * by the reconfigure flow - they clear but never block). Pure, so the page's gate and the two
 * sections stay one testable rule.
 */
export function splitForkClearedRefs(visibleRefs: ForkClearedRef[]): {
  blockers: ForkClearedRef[]
  informational: ForkClearedRef[]
} {
  const blockers: ForkClearedRef[] = []
  const informational: ForkClearedRef[] = []
  for (const ref of visibleRefs) {
    if (forkSyncBlockerReasonFor(ref)) blockers.push(ref)
    else informational.push(ref)
  }
  return { blockers, informational }
}

/** Human label per blocker kind for the resolution copy (singular, lowercase mid-sentence). */
const BLOCKER_KIND_LABEL: Record<string, string> = {
  table: 'table',
  'knowledge-base': 'knowledge base',
  file: 'file',
  'custom-tool': 'custom tool',
  skill: 'skill',
  'mcp-server': 'MCP server',
}

/**
 * The actionable resolution line for a blocking entry, phrased for "{block} would lose {field}
 * in {workflow} - {resolution}". Null for non-blocking (dependent) entries.
 */
export function forkBlockerResolution(ref: ForkClearedRef): string | null {
  const reason = forkSyncBlockerReasonFor(ref)
  if (!reason) return null
  switch (reason) {
    case 'unmapped-copyable':
      return 'map it to a target or select it for copy'
    case 'source-deleted':
      return `deleted in the source — map it to an existing ${BLOCKER_KIND_LABEL[ref.kind] ?? 'resource'} in the target`
    case 'workflow-missing':
      return `deploy "${ref.sourceLabel}" in the source or remove the reference`
  }
}
