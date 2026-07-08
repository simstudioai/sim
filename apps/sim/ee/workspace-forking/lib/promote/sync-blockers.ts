import {
  type ForkClearedRef,
  type ForkSyncBlocker,
  type ForkSyncBlockerReason,
  forkCopyableKindSchema,
} from '@/lib/api/contracts/workspace-fork'

/**
 * Pure sync-blocker taxonomy, shared by the server gate (promote) and the modal's blocker
 * rendering. A sync is allowed only when ZERO references would clear in any synced target
 * workflow; every would-clear entry of cause `reference` or `workflow` is a blocker with an
 * actionable reason. `dependent`-cause entries are NOT blockers - the dependent/reconfigure
 * flow owns them (its own required gating), and a credential-anchored dependent clears on any
 * parent remap, so blocking on it would be unresolvable.
 */

/** Copyable kinds derived from the wire contract, so the reason split can never drift. */
const COPYABLE_BLOCKER_KINDS: ReadonlySet<string> = new Set(forkCopyableKindSchema.options)

/**
 * The blocker reason for a would-clear entry, or null when the entry does not block
 * (`dependent` cause, and - defensively - any kind the cleared-ref collector excludes):
 *  - `workflow` cause -> `workflow-missing` (deploy the referenced workflow in the source, or
 *    remove the reference).
 *  - `reference` + source deleted -> `source-deleted` (map the dead id to a live target
 *    resource, or fix/archive the source workflow).
 *  - `reference` + copyable kind (incl. external MCP servers) -> `unmapped-copyable` (map it
 *    or select it for copy).
 */
export function forkSyncBlockerReasonFor(ref: ForkClearedRef): ForkSyncBlockerReason | null {
  if (ref.cause === 'workflow') return 'workflow-missing'
  if (ref.cause !== 'reference') return null
  if (ref.sourceDeleted) return 'source-deleted'
  if (COPYABLE_BLOCKER_KINDS.has(ref.kind)) return 'unmapped-copyable'
  // Credential / env-var / knowledge-document never reach the cleared list (excluded by the
  // collector; the first two gate via the kind-level required gate, documents follow their KB).
  return null
}

/** The would-clear entries that BLOCK the sync, paired with their reason. */
export function selectForkSyncBlockingRefs(
  clearedRefs: ForkClearedRef[]
): Array<{ ref: ForkClearedRef; reason: ForkSyncBlockerReason }> {
  return clearedRefs.flatMap((ref) => {
    const reason = forkSyncBlockerReasonFor(ref)
    return reason ? [{ ref, reason }] : []
  })
}

/** Map blocking entries to the wire {@link ForkSyncBlocker} shape of the promote gate error. */
export function toForkSyncBlockers(
  blocking: Array<{ ref: ForkClearedRef; reason: ForkSyncBlockerReason }>
): ForkSyncBlocker[] {
  return blocking.map(({ ref, reason }) => ({
    workflowName: ref.workflowName,
    blockLabel: ref.blockLabel,
    fieldLabel: ref.fieldLabel,
    kind: ref.kind,
    sourceId: ref.sourceId,
    sourceLabel: ref.sourceLabel,
    reason,
  }))
}
