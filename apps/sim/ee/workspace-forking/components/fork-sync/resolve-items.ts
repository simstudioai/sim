import type { ForkClearedRef, ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'
import { forkKindPhrase } from '@/ee/workspace-forking/components/fork-kind-label'
import { forkRefKey } from '@/ee/workspace-forking/components/fork-sync/copy-reconciliation'
import { forkSyncBlockerReasonFor } from '@/ee/workspace-forking/lib/promote/sync-blockers'

/**
 * How far along one reference is, ordered by how much it still needs from the user. The sync gate
 * is exactly "no `blocking` and no `needs-setup`", so the badge a row wears and the reason the
 * Sync chip gives can never disagree.
 */
export type ForkResolveStatus =
  | 'blocking'
  | 'needs-setup'
  | 'will-clear'
  | 'dropped'
  | 'copied'
  | 'mapped'

/** Rank per status, so the rows that still need work sort to the top of the list. */
const STATUS_RANK: Record<ForkResolveStatus, number> = {
  blocking: 0,
  'needs-setup': 1,
  'will-clear': 2,
  dropped: 3,
  copied: 4,
  mapped: 5,
}

/** One reference the sync has to resolve, as a single row. */
export interface ForkResolveItem {
  /** `${kind}:${sourceId}` for a mapped reference, or the cleared-ref identity for a workflow one. */
  key: string
  kind: string
  label: string
  status: ForkResolveStatus
  /** The mapping entry behind the row, when there is one. Absent on cross-workflow references. */
  entry: ForkMappingEntry | null
  /** One sentence naming what is wrong and how to fix it. Null when nothing is. */
  detail: string | null
  /**
   * How many fields dropping this reference would clear. Non-null only for a source-deleted
   * reference, the one case a drop is offered for — an unmapped copyable can still be copied and a
   * missing workflow can still be deployed, so neither is a dead end to accept away.
   */
  dropFieldCount: number | null
}

/** Everything the derivation needs about the live selection, supplied by the sync controller. */
export interface ForkResolveInputs {
  entries: ForkMappingEntry[]
  /** Effective mapping target per entry, in-session edits included. */
  targetFor: (entry: ForkMappingEntry) => string
  copyingKeys: ReadonlySet<string>
  droppedRefs: ReadonlySet<string>
  /** Entries whose resolved parent still has a required dependent field without a value. */
  reconfigPendingKeys: ReadonlySet<string>
  /** How many required dependent fields each entry is still missing. */
  reconfigPendingCounts: ReadonlyMap<string, number>
  blockingRefs: ForkClearedRef[]
  /** Would-clear references that never block, so an unresolved optional reference can say so. */
  dependentClears: ForkClearedRef[]
}

/** "Enrich would lose Table in Support triage" — the concrete place a reference is used. */
function whereItHurts(ref: ForkClearedRef): string {
  return `${ref.blockLabel} would lose ${ref.fieldLabel} in ${ref.workflowName}`
}

/** The one-sentence fix for a blocking reference, phrased for the row it sits on. */
function blockerDetail(ref: ForkClearedRef, dropFieldCount: number): string {
  switch (forkSyncBlockerReasonFor(ref)) {
    case 'unmapped-copyable':
      return `${whereItHurts(ref)}. Map it to an existing ${forkKindPhrase(ref.kind)} or copy it across.`
    case 'source-deleted':
      return dropFieldCount > 1
        ? `Deleted in the source workspace. Map it to a live ${forkKindPhrase(ref.kind)}, or drop it from all ${dropFieldCount} fields that use it.`
        : `Deleted in the source workspace. Map it to a live ${forkKindPhrase(ref.kind)}, or drop it.`
    case 'workflow-missing':
      return `${whereItHurts(ref)}. Deploy “${ref.sourceLabel}” in the source workspace, or remove the reference.`
    default:
      return whereItHurts(ref)
  }
}

/**
 * Every reference this sync has to resolve, as one ordered list.
 *
 * The sync page used to split this across four sections — the mapping editor, the copy picker, the
 * blocker list, and the will-clear list — which meant one resource could appear in three of them
 * and the user had to reconcile them by eye. Here each reference is one row that states where it
 * stands, what breaks if it stays there, and offers the single control that fixes it.
 *
 * Pure over the controller's derived state, so the ordering and the wording stay testable and the
 * sync gate keeps its own separate derivation as the authority.
 */
export function buildForkResolveItems(inputs: ForkResolveInputs): ForkResolveItem[] {
  const {
    entries,
    targetFor,
    copyingKeys,
    droppedRefs,
    reconfigPendingKeys,
    reconfigPendingCounts,
    blockingRefs,
    dependentClears,
  } = inputs

  /** Blocking rows indexed by resource, so a row can state how many fields one drop covers. */
  const blockersByResource = new Map<string, ForkClearedRef[]>()
  for (const ref of blockingRefs) {
    const key = forkRefKey(ref)
    const group = blockersByResource.get(key)
    if (group) group.push(ref)
    else blockersByResource.set(key, [ref])
  }

  /** Optional would-clear references, so an unresolved-but-not-blocking row can name its cost. */
  const clearsByResource = new Map<string, ForkClearedRef>()
  for (const ref of dependentClears) {
    const key = forkRefKey(ref)
    if (!clearsByResource.has(key)) clearsByResource.set(key, ref)
  }

  const items: ForkResolveItem[] = []
  const claimed = new Set<string>()

  for (const entry of entries) {
    const key = forkRefKey(entry)
    claimed.add(key)
    const blockers = blockersByResource.get(key) ?? []
    const droppable = blockers.some((ref) => forkSyncBlockerReasonFor(ref) === 'source-deleted')
    const dropFieldCount = droppable ? blockers.length : null

    const status: ForkResolveStatus = droppedRefs.has(key)
      ? 'dropped'
      : blockers.length > 0
        ? 'blocking'
        : reconfigPendingKeys.has(key)
          ? 'needs-setup'
          : copyingKeys.has(key)
            ? 'copied'
            : targetFor(entry) !== ''
              ? 'mapped'
              : entry.required
                ? 'blocking'
                : 'will-clear'

    const pendingFields = reconfigPendingCounts.get(key) ?? 0
    const detail =
      status === 'blocking'
        ? blockers.length > 0
          ? blockerDetail(blockers[0], blockers.length)
          : `Required. Map it to a ${forkKindPhrase(entry.kind)} in the target workspace.`
        : status === 'needs-setup'
          ? pendingFields === 1
            ? 'One required field still needs a value.'
            : `${pendingFields} required fields still need values.`
          : status === 'dropped'
            ? 'Accepted as lost. Every field naming it will be cleared in the target.'
            : status === 'will-clear'
              ? (() => {
                  const ref = clearsByResource.get(key)
                  return ref
                    ? `${whereItHurts(ref)} unless you map or copy it.`
                    : 'Leaving this unmapped clears every field that references it.'
                })()
              : null

    items.push({
      key,
      kind: entry.kind,
      label: entry.sourceLabel,
      status,
      entry,
      detail,
      dropFieldCount,
    })
  }

  // Cross-workflow references have no mapping entry to hang off — nothing in the target can stand
  // in for a workflow that was never carried across — so they join the list on their own.
  for (const ref of blockingRefs) {
    const key = forkRefKey(ref)
    if (claimed.has(key)) continue
    claimed.add(key)
    items.push({
      key,
      kind: ref.kind,
      label: ref.sourceLabel,
      status: 'blocking',
      entry: null,
      detail: blockerDetail(ref, 1),
      dropFieldCount: null,
    })
  }

  return items.sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label)
  )
}

/** Tallies for the Resolve section's progress line. */
export interface ForkResolveProgress {
  total: number
  resolved: number
  blocking: number
  needsSetup: number
}

export function forkResolveProgress(items: ForkResolveItem[]): ForkResolveProgress {
  let blocking = 0
  let needsSetup = 0
  let resolved = 0
  for (const item of items) {
    if (item.status === 'blocking') blocking++
    else if (item.status === 'needs-setup') needsSetup++
    else if (item.status !== 'will-clear') resolved++
  }
  return { total: items.length, resolved, blocking, needsSetup }
}
