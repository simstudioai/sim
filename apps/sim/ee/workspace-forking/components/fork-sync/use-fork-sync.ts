'use client'

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  ForkClearedRef,
  ForkCopyableUnmapped,
  ForkDependentReconfig,
  ForkMappingEntry,
  ForkResourceUsage,
  ForkWorkflowChange,
} from '@/lib/api/contracts/workspace-fork'
import {
  selectVisibleClearedRefs,
  splitForkClearedRefs,
} from '@/ee/workspace-forking/components/fork-sync/cleared-refs-list'
import {
  effectiveForkTarget,
  type ForkParentResolution,
  forkCopyingKeys,
  forkDefaultCopySelection,
  forkMappedCopyableKeys,
  forkParentResolution,
  forkRefKey,
  forkRequiredKindsLabel,
  forkRequiredPending,
  forkVisibleCopyables,
  isForkRequiredComplete,
} from '@/ee/workspace-forking/components/fork-sync/copy-reconciliation'
import {
  dependentKey,
  effectiveCopyDependentValue,
  effectiveDependentValue,
} from '@/ee/workspace-forking/components/fork-sync/dependent-value'
import {
  type ForkDirection,
  useForkDiff,
  useForkMapping,
  usePromoteFork,
  useUpdateForkMapping,
} from '@/ee/workspace-forking/hooks/workspace-fork'

/**
 * The mapping kinds that can be a standalone mapping entry. `knowledge-document` is excluded:
 * the mapping view (`getForkMappingView`) skips documents — they ride their parent KB via the
 * reconfigure flow — so a `knowledge-document` mapping section is never reachable.
 */
export type MappableMappingKind = Exclude<ForkMappingEntry['kind'], 'knowledge-document'>

/** Section label + display order per mapping kind (one mapping group per kind). */
const MAPPING_SECTION: Record<MappableMappingKind, { label: string; order: number }> = {
  credential: { label: 'Credentials', order: 0 },
  'env-var': { label: 'Secrets', order: 1 },
  table: { label: 'Tables', order: 2 },
  'knowledge-base': { label: 'Knowledge bases', order: 3 },
  file: { label: 'Files', order: 4 },
  'mcp-server': { label: 'MCP servers', order: 5 },
  'custom-tool': { label: 'Custom tools', order: 6 },
  skill: { label: 'Skills', order: 7 },
}

/** Shared empty owners map for the pull direction so the options mapper never re-allocates. */
const EMPTY_TARGET_OWNERS: ReadonlyMap<string, string> = new Map()

/**
 * Stable empty arrays so an entry with no usages/dependents keeps a constant prop reference,
 * letting the workflow-card grouping memos skip recompute across the page's frequent re-renders.
 */
const EMPTY_USAGES: ForkResourceUsage['workflows'] = []
const EMPTY_DEPENDENTS: ForkDependentReconfig[] = []

/** Target workflows this sync archives, previewed in the confirm before "and X more". */
export const ARCHIVED_PREVIEW_LIMIT = 5

export interface ForkMappingGroup {
  kind: MappableMappingKind
  label: string
  items: ForkMappingEntry[]
}

/** Per-kind mapping status for the Mappings section's summary badges. */
export interface ForkKindSummary {
  kind: MappableMappingKind
  total: number
  mapped: number
  copied: number
  requiredPending: boolean
  reconfigPending: boolean
}

export interface ForkSyncController {
  direction: ForkDirection
  otherWorkspaceName: string
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  /** Diff fetch failure, surfaced inline (the mapping may still have loaded). */
  diffErrorMessage: string | null
  /** True once the diff payload for ANY direction is present (placeholder included). */
  hasDiff: boolean
  /** True once the mapping payload is present (placeholder included), gating the Mappings section. */
  hasMapping: boolean
  groups: ForkMappingGroup[]
  /** Per-kind mapping status, aligned with `groups` (same kinds, same order). */
  kindSummaries: ForkKindSummary[]
  /** Effective (in-session override, else persisted/suggested) target for an entry. */
  targetFor: (entry: ForkMappingEntry) => string
  /** Set an entry's target ('' clears it) and drop its dependents' stale re-picks. */
  setTarget: (entry: ForkMappingEntry, value: string) => void
  /** Targets already claimed by another source in the same kind (push targets are unique; pull never disables). */
  takenOwnersFor: (
    entry: ForkMappingEntry,
    items: ForkMappingEntry[]
  ) => ReadonlyMap<string, string>
  /** Every workflow an entry's resource is used in (diff-fed; empty until the diff loads). */
  usagesForEntry: (entry: ForkMappingEntry) => ForkResourceUsage['workflows']
  /** An entry's dependent fields (its credential/KB/table's selectors), from the diff. */
  dependentsForEntry: (entry: ForkMappingEntry) => ForkDependentReconfig[]
  /**
   * Whether an entry needs an in-place reconfigure: its effective target changed in-session,
   * or it's an unconfirmed suggestion (accepting it as-is still remaps + clears the dependents).
   */
  parentChangedFor: (entry: ForkMappingEntry) => boolean
  /** The workspace a MAPPED parent's dependent selectors query against (direction-aware from the diff). */
  targetWorkspaceId: string
  /**
   * The sync's source workspace (push: this one; pull: the other), which a COPY-resolved
   * parent's dependent selectors browse - the copy will contain the source parent's children,
   * so the source is the truthful catalog to pick from.
   */
  sourceWorkspaceId: string
  /** In-session dependent re-picks, keyed by `dependentKey`. */
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
  /** Keys the backend offers as copy candidates, for the entry rows' "Copy instead" affordance. */
  copyableKeys: ReadonlySet<string>
  /** Copyables actually selected for copy (visible + checked), keyed `${kind}:${sourceId}`. */
  copyingKeys: ReadonlySet<string>
  /** The raw copy selection (visible-ness not applied), for per-kind selected-id derivation. */
  copySelected: ReadonlySet<string>
  toggleCopyKeys: (keys: string[], checked: boolean) => void
  /** Visible copy candidates split by referenced-ness, grouped per kind for the section rows. */
  referencedByKind: ReadonlyMap<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>
  unreferencedByKind: ReadonlyMap<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>
  hasVisibleCopyables: boolean
  /** Would-clear references that BLOCK sync (mirrors the server's zero-cleared-refs gate). */
  blockingRefs: ForkClearedRef[]
  /** Informational would-clear dependents (owned by the reconfigure flow; never block). */
  dependentClears: ForkClearedRef[]
  /** Deployed-workflow change list (update → create → archive, then by name). */
  workflowChanges: ForkWorkflowChange[]
  /** Names of target workflows this sync archives, for the confirm modal. */
  archivedWorkflowNames: string[]
  mcpReauthCount: number
  inlineSecretCount: number
  dirty: boolean
  saving: boolean
  save: () => void
  discard: () => void
  submitting: boolean
  syncDisabled: boolean
  /** Names the failing gate for the disabled Sync chip's tooltip; undefined when enabled. */
  syncDisabledReason: string | undefined
  /** Persist the effective mapping + dependents + copy selection, then promote. */
  sync: () => Promise<void>
}

const entryKey = (entry: ForkMappingEntry) => forkRefKey(entry)

/**
 * Whether a mapping entry needs an in-place reconfigure: its effective target was changed
 * in-session, or it's an unconfirmed suggestion (accepting it as-is still remaps + clears
 * the dependents). Pure over (entry, in-session targets) so the inline render, the Sync
 * gate, and the payload build share one predicate instead of drifting copies.
 */
function shouldReconfigureEntry(entry: ForkMappingEntry, targets: Record<string, string>): boolean {
  const next = targets[entryKey(entry)] ?? entry.targetId ?? ''
  if (next === '') return false
  return entry.suggested || next !== (entry.targetId ?? '')
}

/**
 * Targets already taken by OTHER sources in the same kind, each mapped to the owning
 * source's label (for a hint). Used to disable those targets on PUSH: a push row is unique
 * on the parent (target) side, so a parent target can back only one source - a second source
 * picking it would be silently dropped on save. Pull is the inverse (many parent sources may
 * share one fork target, which resolves correctly), so pull passes the empty map and never
 * disables. Excludes `exclude` so a source never disables its own current selection.
 */
function takenTargetOwners(
  items: ForkMappingEntry[],
  targets: Record<string, string>,
  exclude: ForkMappingEntry
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const item of items) {
    if (entryKey(item) === entryKey(exclude)) continue
    const target = targets[entryKey(item)] ?? item.targetId ?? ''
    if (target !== '') owners.set(target, item.sourceLabel)
  }
  return owners
}

/**
 * The full sync surface's state for one fork edge, in the chosen direction: the editable
 * resource mapping (in-session target overrides + dependent re-picks, persisted via Save or
 * as part of Sync), the copy-resources selection (seeded once the diff settles), the reactive
 * would-clear blockers, the per-kind status summaries, the Sync gate, and the promote run
 * itself. A direction switch drops every in-session choice — the mapping set, copy candidates,
 * and blockers all depend on the direction — and the copy selection re-seeds only from a
 * settled (non-placeholder) diff so a stale payload can't latch wrong keys.
 */
export function useForkSync(params: {
  workspaceId: string
  otherWorkspaceId?: string
  otherWorkspaceName: string
  direction: ForkDirection
  enabled: boolean
}): ForkSyncController {
  const { workspaceId, otherWorkspaceId, otherWorkspaceName, direction, enabled } = params

  // User's IN-SESSION mapping overrides only - NOT the source of truth. The displayed/persisted
  // target falls back to each entry's stored `targetId` (see `targetFor`), so a reopened edge
  // shows its remembered mappings even though React Query's structural sharing keeps `entries`
  // referentially stable (a target-seeding effect gated on `entries` would never re-run there).
  const [targets, setTargets] = useState<Record<string, string>>({})
  // In-session re-picks for dependent fields whose parent the user swapped, keyed by
  // `dependentKey`. Folded into the full effective set sent on save/sync, which the server
  // persists as the stored mapping - so the selection survives every future sync without
  // re-picking.
  const [reconfig, setReconfig] = useState<Record<string, string>>({})
  // Referenced-but-unmapped resources the user chose to copy into the target (keyed by
  // `${kind}:${sourceId}`); default-selected once the diff loads. Selected ones are copied on
  // sync so their references resolve to the copy instead of being cleared.
  const [copySelected, setCopySelected] = useState<Set<string>>(new Set())
  const [copyDefaulted, setCopyDefaulted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Drop every in-session choice when the direction (or edge) changes - the mapping set,
  // copy candidates, and blockers all depend on it.
  useEffect(() => {
    setTargets({})
    setReconfig({})
    setCopySelected(new Set())
    setCopyDefaulted(false)
  }, [direction, otherWorkspaceId])

  const mapping = useForkMapping({ workspaceId, otherWorkspaceId, direction, enabled })
  const diff = useForkDiff({ workspaceId, otherWorkspaceId, direction, enabled })
  const updateMapping = useUpdateForkMapping()
  const promote = usePromoteFork()

  const entries = useMemo<ForkMappingEntry[]>(() => mapping.data?.entries ?? [], [mapping.data])
  const dependentReconfigs = useMemo(
    () => diff.data?.dependentReconfigs ?? [],
    [diff.data?.dependentReconfigs]
  )
  const resourceUsages = useMemo(() => diff.data?.resourceUsages ?? [], [diff.data?.resourceUsages])
  const copyableUnmapped = useMemo(
    () => diff.data?.copyableUnmapped ?? [],
    [diff.data?.copyableUnmapped]
  )
  const clearedRefs = useMemo(() => diff.data?.clearedRefs ?? [], [diff.data?.clearedRefs])

  // Keys the backend offers as copy candidates, so the entry rows show a "Copy instead"
  // affordance only for those - clearing a name-match suggestion returns the ref to the copy
  // list (it re-enters `visibleCopyables` once its effective target is '').
  const copyableKeys = useMemo(
    () => new Set(copyableUnmapped.map((candidate) => forkRefKey(candidate))),
    [copyableUnmapped]
  )

  // Copy-vs-map reconciliation: a copyable resource the user has given an effective (in-session
  // or persisted) mapping target must NOT also appear in the copy list - the user picked map, not
  // copy. `forkRefKey` shares the `${kind}:${sourceId}` keyspace across entries and candidates,
  // so a mapped entry's key directly excludes its copy candidate. The server enforces the same
  // precedence: a mapped resource resolves != null, so it never reaches the plan's
  // `copyableUnmapped`, and a copy request for it is dropped by `buildPromoteCopySelection`.
  const mappedCopyableKeys = useMemo(
    () => forkMappedCopyableKeys(entries, targets),
    [entries, targets]
  )

  const visibleCopyables = useMemo(
    () => forkVisibleCopyables(copyableUnmapped, mappedCopyableKeys),
    [copyableUnmapped, mappedCopyableKeys]
  )

  // Copyables actually selected for copy (visible + checked), keyed for an O(1) lookup so a
  // copyable mapping entry can show a "will be copied" note.
  const copyingKeys = useMemo(
    () => forkCopyingKeys(visibleCopyables, copySelected),
    [visibleCopyables, copySelected]
  )

  // Group the visible copy candidates by kind so each renders as its own expandable section
  // (chevron + tri-state select-all + count), matching the fork picker. Referenced and
  // unreferenced candidates group separately: unreferenced ones (used by no synced workflow)
  // render under a muted "Not used by any workflow" grouping and default to unselected.
  const { referencedByKind, unreferencedByKind } = useMemo(() => {
    const referenced = new Map<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>()
    const unreferenced = new Map<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>()
    for (const candidate of visibleCopyables) {
      const groups = candidate.referenced ? referenced : unreferenced
      const list = groups.get(candidate.kind)
      if (list) list.push(candidate)
      else groups.set(candidate.kind, [candidate])
    }
    return { referencedByKind: referenced, unreferencedByKind: unreferenced }
  }, [visibleCopyables])

  // Default every REFERENCED copyable resource to "copy" once the diff loads, so the common case
  // (bring the referenced resources along) needs no clicks; the user can deselect to clear
  // instead. Unreferenced candidates start unselected (see `forkDefaultCopySelection`) - copying
  // them is opt-in since nothing references them. Seed ONLY from a settled diff for the current
  // direction: on a direction switch the reset clears `copyDefaulted`, but `useForkDiff` keeps
  // the previous direction's payload (placeholderData) until the new fetch resolves - seeding
  // from it would latch against stale keys and leave the real copyables unchecked, clearing
  // their references on Sync.
  useEffect(() => {
    if (!enabled || diff.isPlaceholderData || copyableUnmapped.length === 0 || copyDefaulted) return
    setCopyDefaulted(true)
    setCopySelected(forkDefaultCopySelection(copyableUnmapped))
  }, [enabled, diff.isPlaceholderData, copyableUnmapped, copyDefaulted])

  // Group dependents by their parent (kind:sourceId) once, so each mapping entry gets a
  // STABLE `dependents` array reference - a fresh `.filter` per render would defeat the
  // workflow-card grouping memos.
  const dependentsByParent = useMemo(() => {
    const map = new Map<string, ForkDependentReconfig[]>()
    for (const dependent of dependentReconfigs) {
      const key = `${dependent.parentKind}:${dependent.parentSourceId}`
      const list = map.get(key)
      if (list) list.push(dependent)
      else map.set(key, [dependent])
    }
    return map
  }, [dependentReconfigs])

  // Effective target for an entry: the user's in-session override if present, else the
  // persisted mapping from the server. Read directly from `entries` so a reopened edge
  // reflects stored mappings without a seeding effect.
  const targetFor = (entry: ForkMappingEntry) => effectiveForkTarget(entry, targets)

  const usagesForEntry = (entry: ForkMappingEntry): ForkResourceUsage['workflows'] =>
    resourceUsages.find(
      (usage) => usage.parentKind === entry.kind && usage.parentSourceId === entry.sourceId
    )?.workflows ?? EMPTY_USAGES

  const dependentsForEntry = (entry: ForkMappingEntry): ForkDependentReconfig[] =>
    dependentsByParent.get(entryKey(entry)) ?? EMPTY_DEPENDENTS

  const parentChangedFor = (entry: ForkMappingEntry): boolean =>
    shouldReconfigureEntry(entry, targets)

  // Set an entry's in-session mapping target. A `value` of '' explicitly clears it, overriding
  // any name-match suggestion (effectiveForkTarget's `??` treats '' as present, so the suggestion
  // no longer wins) - so the resource re-enters `visibleCopyables` and is copy-selectable again.
  // Changing the parent invalidates its dependents' in-session re-picks (chosen against the old
  // account), so drop them.
  const setTarget = (entry: ForkMappingEntry, value: string) => {
    setTargets((prev) => ({ ...prev, [entryKey(entry)]: value }))
    setReconfig((prev) => {
      let changed = false
      const next = { ...prev }
      for (const dependent of dependentsForEntry(entry)) {
        const key = dependentKey(dependent)
        if (key in next) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  const takenOwnersFor = (
    entry: ForkMappingEntry,
    items: ForkMappingEntry[]
  ): ReadonlyMap<string, string> =>
    direction === 'push' ? takenTargetOwners(items, targets, entry) : EMPTY_TARGET_OWNERS

  const toggleCopyKeys = (keys: string[], checked: boolean) =>
    setCopySelected((prev) => {
      const next = new Set(prev)
      for (const key of keys) {
        if (checked) next.add(key)
        else next.delete(key)
      }
      return next
    })

  // Group mappings by resource type - one accordion row per kind, required types first.
  const groups = useMemo<ForkMappingGroup[]>(() => {
    const byKind = new Map<MappableMappingKind, ForkMappingEntry[]>()
    for (const entry of entries) {
      // The mapping view never emits a document entry (it rides its KB), so the group is
      // unreachable - skip defensively so the narrowed `MAPPING_SECTION` lookup stays sound.
      if (entry.kind === 'knowledge-document') continue
      const list = byKind.get(entry.kind)
      if (list) list.push(entry)
      else byKind.set(entry.kind, [entry])
    }
    return Array.from(byKind, ([kind, items]) => ({
      kind,
      label: MAPPING_SECTION[kind].label,
      items: items.slice().sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel)),
    })).sort((a, b) => MAPPING_SECTION[a.kind].order - MAPPING_SECTION[b.kind].order)
  }, [entries])

  // The mapping entry each dependent hangs off, indexed by `kind:sourceId` (matching `entryKey`)
  // so the per-field lookups below are O(1) instead of rescanning `entries` for every dependent -
  // and several times per field across the Sync gate, the value helper, and the payload build.
  const entriesByParent = useMemo(() => {
    const map = new Map<string, ForkMappingEntry>()
    for (const entry of entries) map.set(entryKey(entry), entry)
    return map
  }, [entries])

  const entryForDependent = (field: ForkDependentReconfig) =>
    entriesByParent.get(`${field.parentKind}:${field.parentSourceId}`)

  const resolutionFor = (entry: ForkMappingEntry): ForkParentResolution =>
    forkParentResolution(entry, targets, copyingKeys)

  // The value sent + displayed for a dependent (delegates to the shared per-resolution rule):
  // the user's re-pick, else - under a MAPPED parent - the stored value (blank when the parent
  // target changed in-session), or - under a COPY-resolved parent - the stored value falling
  // back to the raw source reference (which the copied parent will contain). Callers that
  // already resolved the parent pass both in to skip repeat lookups.
  const dependentValueFor = (
    field: ForkDependentReconfig,
    parent = entryForDependent(field),
    resolution: ForkParentResolution = parent ? resolutionFor(parent) : 'unresolved'
  ): string => {
    if (resolution === 'copied') return effectiveCopyDependentValue(field, reconfig)
    return effectiveDependentValue(
      field,
      reconfig,
      parent ? shouldReconfigureEntry(parent, targets) : false
    )
  }

  // A required reference is satisfied when it has a mapping target OR the user selected it for
  // copy (the server accepts a copy as resolving a required ref). See `isForkRequiredComplete`.
  const requiredComplete = isForkRequiredComplete(entries, targets, copyingKeys)

  // Every required dependent whose parent is RESOLVED must have a value before sync. Under a
  // mapped parent the user re-picks against the target; under a copy-resolved parent the field
  // pre-fills with the source reference (the copy carries it), so it's satisfied out of the box
  // and gates only when explicitly emptied. A dependent whose parent is unresolved can't be
  // picked yet (its selector is disabled) and is gated by `requiredComplete` on the parent
  // instead, so it's skipped here.
  const reconfigComplete = dependentReconfigs.every((field) => {
    if (!field.required) return true
    const parent = entryForDependent(field)
    if (!parent) return true
    const resolution = resolutionFor(parent)
    if (resolution === 'unresolved') return true
    return dependentValueFor(field, parent, resolution) !== ''
  })

  // Kinds with a required DEPENDENT that still has no value (its parent is resolved): these
  // block Sync via `reconfigComplete`, so the summary badge for that kind must not read
  // "Fully mapped".
  const reconfigPendingByKind = new Set<MappableMappingKind>()
  for (const field of dependentReconfigs) {
    if (!field.required) continue
    const parent = entryForDependent(field)
    if (!parent) continue
    const resolution = resolutionFor(parent)
    if (resolution === 'unresolved') continue
    if (dependentValueFor(field, parent, resolution) === '') {
      reconfigPendingByKind.add(parent.kind as MappableMappingKind)
    }
  }

  // The references this sync would blank, reactively narrowed to the current selection. A
  // resource is "resolved" once it has a mapping target OR is selected for copy - the same
  // predicate drives a `reference` (its own resource) and a `dependent` (its PARENT resource),
  // so mapping or copying a parent KB makes its child document drop off. Then split:
  // `reference`/`workflow` entries are BLOCKERS (Sync stays disabled while any remain -
  // mirroring the server's zero-cleared-refs gate); `dependent` entries stay informational
  // (the reconfigure flow owns them).
  const { blockers: blockingRefs, informational: dependentClears } = useMemo(() => {
    const isResolved = (kind: string, sourceId: string) => {
      const key = `${kind}:${sourceId}`
      const entry = entriesByParent.get(key)
      const mapped = entry ? (targets[key] ?? entry.targetId ?? '') !== '' : false
      return mapped || copyingKeys.has(key)
    }
    return splitForkClearedRefs(selectVisibleClearedRefs(clearedRefs, isResolved))
  }, [clearedRefs, entriesByParent, targets, copyingKeys])

  // Per-kind status for the Mappings summary: "Fully mapped" or "n/total mapped", flagged when
  // a REQUIRED target is still missing (which blocks Sync). Reads the effective
  // (override-or-persisted) target so it reflects both remembered mappings and in-session edits.
  const kindSummaries: ForkKindSummary[] = groups.map((group) => {
    const total = group.items.length
    const mapped = group.items.filter((entry) => targetFor(entry) !== '').length
    // Copy-selected items are resolved too (their refs are kept), so they count toward
    // completion and render as "copied" rather than unconfigured. mapped/copied are disjoint:
    // a mapped copyable is excluded from the copy candidates, so copyingKeys never overlaps a
    // mapped entry.
    const copied = group.items.filter((entry) => copyingKeys.has(entryKey(entry))).length
    // Mirror the Sync gate: a required ref selected for copy is satisfied, so it is not
    // "pending".
    const requiredPending = forkRequiredPending(group.items, targets, copyingKeys)
    const reconfigPending = reconfigPendingByKind.has(group.kind)
    return { kind: group.kind, total, mapped, copied, requiredPending, reconfigPending }
  })

  // Kinds whose required gate is still failing, so the Sync tooltip can name the actual
  // obstacle. An unmapped credential/secret is NEVER a cleared-ref blocker (the collector
  // excludes required kinds), so the required gate must not borrow the blocker message -
  // it would point at a "Blocking sync" section that isn't rendered.
  const pendingRequiredKinds = new Set<string>(
    kindSummaries.filter((summary) => summary.requiredPending).map((summary) => summary.kind)
  )

  // Sync details still settling for the current direction: loading, a failed/empty mapping
  // (`!mapping.data` must not read as "nothing required"), or the PREVIOUS direction's
  // placeholder after a switch (syncing on it would send stale mappings/copies and clear
  // references). Until `diff.data` arrives `dependentReconfigs` is empty, so `reconfigComplete`
  // is vacuously true.
  const dataPending =
    mapping.isLoading ||
    !mapping.data ||
    mapping.isPlaceholderData ||
    !diff.data ||
    diff.isPlaceholderData
  // A failed fetch also gates Sync: a failed REFETCH keeps the last successful payload in
  // `data` (so `dataPending` stays false), and every gate below would be judging that stale
  // snapshot while the page shows the load error.
  const dataError = mapping.isError || diff.isError
  // Zero-blockers invariant (mirrors the server gate): Sync stays disabled while ANY reference
  // would clear in a synced target workflow. `requiredComplete` covers the mapping entries
  // (credentials/secrets and unresolved resource refs); `blockingRefs` additionally covers
  // workflow-to-workflow references, which have no mapping entry to resolve.
  const syncBlocked = blockingRefs.length > 0
  const syncDisabled =
    submitting ||
    !otherWorkspaceId ||
    !requiredComplete ||
    !reconfigComplete ||
    syncBlocked ||
    dataPending ||
    dataError

  // A load failure outranks the gates - they're computed from the stale (or absent) payload,
  // so naming one would mislead. Then priority mirrors the resolution flow: clear the
  // blockers, map the required resources, reconfigure their dependents - each failing gate
  // names ITS obstacle (an unmapped credential/secret is a required-mapping failure, not a
  // cleared-ref blocker; see `pendingRequiredKinds`).
  const syncDisabledReason = dataError
    ? "Couldn't load sync details — reload the page to retry"
    : syncBlocked
      ? 'Resolve every blocking reference first — map it, copy it, or fix it in the source'
      : !requiredComplete
        ? `Map all required ${forkRequiredKindsLabel(pendingRequiredKinds)} first`
        : !reconfigComplete
          ? 'Reconfigure all required fields first'
          : dataPending
            ? 'Loading sync details…'
            : undefined

  const workflowChanges = useMemo<ForkWorkflowChange[]>(() => {
    const order: Record<ForkWorkflowChange['action'], number> = { update: 0, create: 1, archive: 2 }
    return [...(diff.data?.workflows ?? [])].sort(
      (a, b) => order[a.action] - order[b.action] || a.currentName.localeCompare(b.currentName)
    )
  }, [diff.data?.workflows])

  // Target workflows this sync archives (their source was deleted), named in the confirm modal
  // so the overwrite warning is concrete.
  const archivedWorkflowNames = useMemo(
    () =>
      workflowChanges
        .filter((change) => change.action === 'archive')
        .map((change) => change.currentName),
    [workflowChanges]
  )

  // Send the full stored mapping for every dependent whose parent is RESOLVED - mapped (its
  // effective value: re-pick, stored, or blank-after-change) or copy-selected (re-pick, stored,
  // or the source reference; promote translates a source document id to its copied counterpart
  // at write time). The server persists this verbatim as the stored mapping; fields whose
  // parent is unresolved are omitted (they can't be configured). This is the whole "what's in
  // the mapping goes in" contract, shared by Save and Sync so the two persist identically.
  const buildDependentValues = () =>
    dependentReconfigs.flatMap((field) => {
      const parent = entryForDependent(field)
      if (!parent) return []
      const resolution = resolutionFor(parent)
      if (resolution === 'unresolved') return []
      return [
        {
          workflowId: field.targetWorkflowId,
          blockId: field.targetBlockId,
          subBlockKey: field.subBlockKey,
          value: dependentValueFor(field, parent, resolution),
        },
      ]
    })

  const buildMappingEntries = () =>
    entries.map((entry) => ({
      resourceType: entry.resourceType,
      sourceId: entry.sourceId,
      targetId: targetFor(entry) || null,
    }))

  // Dirty only on a real change from the stored/suggested target - so a freshly loaded
  // mapping (even with name-match suggestions shown) isn't dirty until the user edits.
  const targetsDirty = useMemo(
    () =>
      entries.some((entry) => {
        const key = entryKey(entry)
        return key in targets && targets[key] !== (entry.targetId ?? '')
      }),
    [entries, targets]
  )

  // A dependent re-pick that differs from its stored value also dirties the editor. A re-pick
  // under a changed parent is covered by `targetsDirty` (the parent override is the change).
  const reconfigDirty = useMemo(
    () =>
      dependentReconfigs.some((field) => {
        const repicked = reconfig[dependentKey(field)]
        return repicked !== undefined && repicked !== field.currentValue
      }),
    [dependentReconfigs, reconfig]
  )

  const dirty = targetsDirty || reconfigDirty

  const save = () => {
    if (!otherWorkspaceId || !dirty || updateMapping.isPending) return
    updateMapping.mutate(
      {
        workspaceId,
        body: {
          otherWorkspaceId,
          direction,
          // Persist the full effective set (WYSIWYG). Only include dependentValues once the
          // diff has loaded; omitted before that so an early save can't wipe the store from
          // an unknown set.
          entries: buildMappingEntries(),
          ...(diff.data ? { dependentValues: buildDependentValues() } : {}),
        },
      },
      {
        onSuccess: () => {
          setTargets({})
          setReconfig({})
          toast.success('Mapping saved')
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to save mapping')),
      }
    )
  }

  const discard = () => {
    setTargets({})
    setReconfig({})
  }

  const sync = async () => {
    if (!otherWorkspaceId) return
    setSubmitting(true)
    // Capture every payload from the state at confirm time, before any await - the page's
    // controls stay mounted during the run (unlike the old modal, which blocked its UI), so a
    // mid-flight edit must not leak into the promote body.
    const mappingEntries = buildMappingEntries()
    const dependentValues = diff.data ? buildDependentValues() : null
    // Copy the referenced-but-unmapped resources the user kept selected, excluding any the
    // user mapped in-session (reconciliation: maps win). The backend validates each id
    // against the plan's copy candidates too, so a mapped/stale id is dropped server-side
    // regardless.
    const selectedCopyables = visibleCopyables.filter((candidate) =>
      copySelected.has(forkRefKey(candidate))
    )
    try {
      await updateMapping.mutateAsync({
        workspaceId,
        body: { otherWorkspaceId, direction, entries: mappingEntries },
      })
      const copyResources = {
        knowledgeBases: selectedCopyables
          .filter((c) => c.kind === 'knowledge-base')
          .map((c) => c.sourceId),
        tables: selectedCopyables.filter((c) => c.kind === 'table').map((c) => c.sourceId),
        customTools: selectedCopyables
          .filter((c) => c.kind === 'custom-tool')
          .map((c) => c.sourceId),
        skills: selectedCopyables.filter((c) => c.kind === 'skill').map((c) => c.sourceId),
        // Files are identified by storage key (the copyable candidate's sourceId is the key).
        files: selectedCopyables.filter((c) => c.kind === 'file').map((c) => c.sourceId),
        mcpServers: selectedCopyables.filter((c) => c.kind === 'mcp-server').map((c) => c.sourceId),
      }

      const result = await promote.mutateAsync({
        workspaceId,
        body: {
          otherWorkspaceId,
          direction,
          // Once the diff has loaded, ALWAYS send the full effective set - including `[]`,
          // which means "every dependent went away" and must reconcile/clear the live replace
          // targets' stored rows. Collapsing `[]` into omission would make the backend
          // PRESERVE stale rows. Only omit before the diff loads (set unknown), so the
          // existing store is left untouched.
          ...(dependentValues !== null ? { dependentValues } : {}),
          ...(selectedCopyables.length > 0 ? { copyResources } : {}),
        },
      })

      if (!result.promoteRunId) {
        if (result.blockers.length > 0) {
          // The server's authoritative gate re-found would-clear references (something changed
          // between the preview and Sync). The mutation's settled invalidation refetches the
          // diff, so the refreshed blocker list is already on its way in.
          const count = result.blockers.length
          toast.error(
            `Sync blocked: ${count} reference${count === 1 ? '' : 's'} would break in the target. Review the updated list and try again.`
          )
          return
        }
        if (result.unmappedRequired.length > 0) {
          // Name the actual blocking kinds rather than always blaming credentials: the server
          // blocks on required REFERENCES (credentials and/or secrets); required dependents are
          // gated client-side before this runs (see the Sync chip's disabled tooltip).
          const kinds = new Set(result.unmappedRequired.map((reference) => reference.kind))
          toast.error(`Map all required ${forkRequiredKindsLabel(kinds)} first`)
          return
        }
        toast.error('Sync did not complete')
        return
      }

      const target = otherWorkspaceName || 'the workspace'
      const label = direction === 'pull' ? `Pulled from "${target}"` : `Pushed to "${target}"`
      // A sync only commits once every reference is mapped/copied and every required dependent
      // has a value (the zero-cleared-refs invariant + `reconfigComplete`), so the old
      // "re-check X block - something may have been cleared" warnings only fired on
      // preview-vs-commit races and read as false alarms. Those rare cases still land in the
      // Activity entry (needsConfiguration/clearedOptional are recorded there) and a
      // needs-config workflow visibly stays undeployed. Deploy FAILURES remain a real,
      // actionable outcome, so they keep a warning.
      if (result.deployFailed > 0) {
        const n = result.deployFailed
        toast.warning(
          `${label}, but ${n} workflow${n === 1 ? '' : 's'} failed to deploy — open and redeploy ${n === 1 ? 'it' : 'them'}.`
        )
      } else {
        toast.success(label)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Sync failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return {
    direction,
    otherWorkspaceName,
    isLoading: enabled && mapping.isLoading,
    isError: mapping.isError,
    errorMessage: mapping.isError ? getErrorMessage(mapping.error, 'Failed to load mapping') : null,
    diffErrorMessage: diff.isError
      ? getErrorMessage(diff.error, "Couldn't load sync details. Reload the page to retry.")
      : null,
    hasDiff: Boolean(diff.data),
    hasMapping: Boolean(mapping.data),
    groups,
    kindSummaries,
    targetFor,
    setTarget,
    takenOwnersFor,
    usagesForEntry,
    dependentsForEntry,
    parentChangedFor,
    targetWorkspaceId: diff.data?.targetWorkspaceId ?? '',
    sourceWorkspaceId: diff.data?.sourceWorkspaceId ?? '',
    reconfig,
    setReconfig,
    copyableKeys,
    copyingKeys,
    copySelected,
    toggleCopyKeys,
    referencedByKind,
    unreferencedByKind,
    hasVisibleCopyables: visibleCopyables.length > 0,
    blockingRefs,
    dependentClears,
    workflowChanges,
    archivedWorkflowNames,
    mcpReauthCount: diff.data?.mcpReauthServerIds.length ?? 0,
    inlineSecretCount: diff.data?.inlineSecretSources.length ?? 0,
    dirty,
    saving: updateMapping.isPending,
    save,
    discard,
    submitting,
    syncDisabled,
    syncDisabledReason,
    sync,
  }
}
