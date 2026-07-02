'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  ChipCombobox,
  ChipConfirmModal,
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  type ChipModalFooterSlotAction,
  ChipModalHeader,
  cn,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight } from 'lucide-react'
import type {
  ForkCopyableUnmapped,
  ForkDependentReconfig,
  ForkLineageNodeApi,
  ForkMappingEntry,
  ForkResourceUsage,
  ForkWorkflowChange,
} from '@/lib/api/contracts/workspace-fork'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  FileKindRow,
  ResourceKindRow,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/fork-resource-picker/fork-resource-picker'
import {
  forkBlockerResolution,
  selectVisibleClearedRefs,
  splitForkClearedRefs,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/cleared-refs-list'
import { ResourceReconfigure } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/components/resource-reconfigure'
import {
  effectiveForkTarget,
  forkCopyingKeys,
  forkDefaultCopySelection,
  forkMappedCopyableKeys,
  forkRefKey,
  forkRequiredKindsLabel,
  forkRequiredPending,
  forkVisibleCopyables,
  isForkRequiredComplete,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/copy-reconciliation'
import {
  dependentKey,
  effectiveDependentValue,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/dependent-value'
import {
  type ForkDirection,
  useForkDiff,
  useForkMapping,
  usePromoteFork,
  useUpdateForkMapping,
} from '@/hooks/queries/workspace-fork'

interface PromoteWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  parent: ForkLineageNodeApi | null
}

const entryKey = (entry: ForkMappingEntry) => forkRefKey(entry)

/**
 * Whether a mapping entry needs an in-place reconfigure: its effective target was changed
 * in-session, or it's an unconfirmed suggestion (accepting it as-is still remaps + clears
 * the dependents). Pure over (entry, in-session targets) so both the inline render and the
 * Sync gate / override collection share one predicate instead of drifting copies.
 */
function shouldReconfigureEntry(entry: ForkMappingEntry, targets: Record<string, string>): boolean {
  const next = targets[entryKey(entry)] ?? entry.targetId ?? ''
  if (next === '') return false
  return entry.suggested || next !== (entry.targetId ?? '')
}

/** Shared empty owners map for the pull direction so the options mapper never re-allocates. */
const EMPTY_TARGET_OWNERS: ReadonlyMap<string, string> = new Map()

/**
 * Stable empty arrays so an entry with no usages/dependents keeps a constant prop reference,
 * letting ResourceReconfigure's grouping memo skip recompute across the editing step's frequent
 * re-renders.
 */
const EMPTY_USAGES: ForkResourceUsage['workflows'] = []
const EMPTY_DEPENDENTS: ForkDependentReconfig[] = []

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
 * The mapping kinds that can be a standalone mapping entry. `knowledge-document` is excluded:
 * the mapping view (`getForkMappingView`) skips documents — they ride their parent KB via the
 * reconfigure flow — so a `knowledge-document` mapping section is never reachable.
 */
type MappableMappingKind = Exclude<ForkMappingEntry['kind'], 'knowledge-document'>

/** Section label + display order per mapping kind (one mapping step per kind). */
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

/**
 * Copyable kinds as expandable sections in the sync "Copy resources" picker, ordered + labeled to
 * match the fork modal's resource picker exactly. Files nest in a folder ▸ file tree; every other
 * kind is a flat list.
 */
const COPYABLE_KIND_SECTIONS: ReadonlyArray<{
  kind: ForkCopyableUnmapped['kind']
  label: string
}> = [
  { kind: 'file', label: 'Files' },
  { kind: 'table', label: 'Tables' },
  { kind: 'knowledge-base', label: 'Knowledge bases' },
  { kind: 'custom-tool', label: 'Custom tools' },
  { kind: 'skill', label: 'Skills' },
]

const copyableKey = (candidate: ForkCopyableUnmapped) => forkRefKey(candidate)

/** Sentinel option value for the editor's "Copy instead" entry - handled via onSelect, never sent. */
const COPY_INSTEAD_VALUE = '__copy_instead__'

/** Archived-workflow names shown in the sync confirm before truncating to "and X more". */
const ARCHIVED_PREVIEW_LIMIT = 5

interface EdgeOption {
  value: string
  label: string
  otherWorkspaceId: string
  direction: ForkDirection
}

/**
 * Fork sync surface. Along the parent edge it force pushes/pulls: the overview
 * picks a direction and lists each resource kind's mapping status, then Sync.
 * "Edit mappings" steps through every kind (Back/Next, each source a
 * settings-style section + full-width target) to set or review targets before
 * landing back on Sync - which always confirms the overwrite first. The durable record of
 * every sync is the Activity log in Manage Forks, so this modal just closes on
 * success.
 */
export function PromoteWorkspaceModal({
  open,
  onOpenChange,
  workspaceId,
  parent,
}: PromoteWorkspaceModalProps) {
  // Sync is only ever performed along the parent edge (from a fork toward its
  // parent). Child edges are intentionally not exposed here - a parent manages its
  // forks (read-only list) rather than pushing/pulling into them.
  const edgeOptions = useMemo<EdgeOption[]>(() => {
    if (!parent) return []
    return [
      {
        value: `push:${parent.id}`,
        label: `Push to ${parent.name}`,
        otherWorkspaceId: parent.id,
        direction: 'push',
      },
      {
        value: `pull:${parent.id}`,
        label: `Pull from ${parent.name}`,
        otherWorkspaceId: parent.id,
        direction: 'pull',
      },
    ]
  }, [parent])

  const [selectedKey, setSelectedKey] = useState('')
  // User's IN-SESSION mapping overrides only - NOT the source of truth. The
  // displayed/persisted target falls back to each entry's stored `targetId`
  // (see `targetFor`), so a reopened edge shows its remembered mappings even
  // though React Query's structural sharing keeps `entries` referentially stable
  // (a target-seeding effect gated on `entries` would never re-run there).
  const [targets, setTargets] = useState<Record<string, string>>({})
  // In-session re-picks for dependent fields whose parent the user swapped, keyed by
  // `dependentKey`. Folded into the full effective set sent on sync, which promote persists as
  // the stored mapping - so the selection survives every future sync without re-picking.
  const [reconfig, setReconfig] = useState<Record<string, string>>({})
  // Referenced-but-unmapped resources the user chose to copy into the target (keyed by
  // `${kind}:${sourceId}`); default-selected once the diff loads. Selected ones are copied on
  // sync so their references resolve to the copy instead of being cleared.
  const [copySelected, setCopySelected] = useState<Set<string>>(new Set())
  const [copyDefaulted, setCopyDefaulted] = useState(false)
  // Wizard step: 0 is the overview; 1..N edit one resource kind each, entered via
  // "Edit mappings". Backing out of step 1 returns to the overview.
  const [step, setStep] = useState(0)
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedKey(edgeOptions[0]?.value ?? '')
    }
  }, [open, edgeOptions])

  // Restart at the overview and drop in-session overrides whenever it (re)opens or
  // the direction changes - the mapping set, and therefore the steps, depend on the
  // direction.
  useEffect(() => {
    setStep(0)
    setTargets({})
    setReconfig({})
    setCopySelected(new Set())
    setCopyDefaulted(false)
  }, [open, selectedKey])

  const selected = edgeOptions.find((option) => option.value === selectedKey)
  const otherWorkspaceId = selected?.otherWorkspaceId
  const direction = selected?.direction ?? 'push'

  const mapping = useForkMapping({ workspaceId, otherWorkspaceId, direction, enabled: open })
  const diff = useForkDiff({ workspaceId, otherWorkspaceId, direction, enabled: open })
  const updateMapping = useUpdateForkMapping()
  const promote = usePromoteFork()

  const entries = useMemo(() => mapping.data?.entries ?? [], [mapping.data])
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

  // Keys the backend offers as copy candidates, so the editor shows a "Copy instead" affordance only
  // for those - clearing a name-match suggestion returns the ref to the copy list (it re-enters
  // `visibleCopyables` once its effective target is '').
  const copyableKeys = useMemo(() => new Set(copyableUnmapped.map(copyableKey)), [copyableUnmapped])

  // Copy-vs-map reconciliation: a copyable resource the user has given an effective (in-session
  // or persisted) mapping target must NOT also appear in the copy list - the user picked map, not
  // copy. `copyableKey` shares the `${kind}:${sourceId}` keyspace with `entryKey`, so a mapped
  // entry's key directly excludes its copy candidate. The server enforces the same precedence:
  // a mapped resource resolves != null, so it never reaches the plan's `copyableUnmapped`, and a
  // copy request for it is dropped by `buildPromoteCopySelection`.
  const mappedCopyableKeys = useMemo(
    () => forkMappedCopyableKeys(entries, targets),
    [entries, targets]
  )

  const visibleCopyables = useMemo(
    () => forkVisibleCopyables(copyableUnmapped, mappedCopyableKeys),
    [copyableUnmapped, mappedCopyableKeys]
  )

  // Copyables actually selected for copy (visible + checked), keyed for an O(1) lookup so a
  // copyable mapping entry in the editor walk can show a "will be copied" note.
  const copyingKeys = useMemo(
    () => forkCopyingKeys(visibleCopyables, copySelected),
    [visibleCopyables, copySelected]
  )

  // Group the visible copy candidates by kind so each renders as its own expandable section
  // (chevron + tri-state select-all + count), matching the fork picker. Files nest in a folder ▸
  // file tree inside their section; every other kind is a flat list. Referenced and unreferenced
  // candidates group separately: unreferenced ones (used by no synced workflow) render under a
  // muted "Not used by any workflow" grouping and default to unselected.
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
  // (bring the referenced resources along) needs no clicks; the user can deselect to clear instead.
  // Unreferenced candidates start unselected (see `forkDefaultCopySelection`) - copying them is
  // opt-in since nothing references them. Seed ONLY from a settled diff for the current direction:
  // on a direction switch the reset clears `copyDefaulted`, but `useForkDiff` keeps the previous
  // direction's payload (placeholderData) until the new fetch resolves - seeding from it would
  // latch against stale keys and leave the real copyables unchecked, clearing their references
  // on Sync.
  useEffect(() => {
    if (!open || diff.isPlaceholderData || copyableUnmapped.length === 0 || copyDefaulted) return
    setCopyDefaulted(true)
    setCopySelected(forkDefaultCopySelection(copyableUnmapped))
  }, [open, diff.isPlaceholderData, copyableUnmapped, copyDefaulted])

  // Group dependents by their parent (kind:sourceId) once, so each mapping entry below gets a
  // STABLE `dependents` array reference - a fresh `.filter` per render would defeat
  // ResourceReconfigure's grouping memo.
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

  // Effective target for an entry: the user's in-session override if present,
  // else the persisted mapping from the server. Read directly from `entries` so
  // a reopened edge reflects stored mappings without a seeding effect.
  const targetFor = (entry: ForkMappingEntry) => effectiveForkTarget(entry, targets)

  // A required reference is satisfied when it has a mapping target OR the user selected it for copy
  // (the server accepts a copy as resolving a required ref). See `isForkRequiredComplete`.
  const requiredComplete = isForkRequiredComplete(entries, targets, copyingKeys)

  // Every workflow a mapping entry's resource is used in, for the always-on reconfigure
  // listing rendered beneath that mapping (so the credential/KB stays in context).
  const usagesForEntry = (entry: ForkMappingEntry): ForkResourceUsage['workflows'] =>
    resourceUsages.find(
      (usage) => usage.parentKind === entry.kind && usage.parentSourceId === entry.sourceId
    )?.workflows ?? EMPTY_USAGES

  // This entry's dependent fields (its credential/KB's selectors), from the memoized grouping.
  const dependentsForEntry = (entry: ForkMappingEntry): ForkDependentReconfig[] =>
    dependentsByParent.get(entryKey(entry)) ?? EMPTY_DEPENDENTS

  // Set an entry's in-session mapping target. A `value` of '' explicitly clears it, overriding any
  // name-match suggestion (effectiveForkTarget's `?? ` treats '' as present, so the suggestion no
  // longer wins) - so the resource re-enters `visibleCopyables` and is copy-selectable again.
  // Changing the parent invalidates its dependents' in-session re-picks (chosen against the old
  // account), so drop them.
  const applyTargetChange = (entry: ForkMappingEntry, value: string) => {
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

  // Group mappings by resource type - one step per kind, required types first.
  const groupedEntries = useMemo(() => {
    const groups = new Map<MappableMappingKind, ForkMappingEntry[]>()
    for (const entry of entries) {
      // The mapping view never emits a document entry (it rides its KB), so the section is
      // unreachable - skip defensively so the narrowed `MAPPING_SECTION` lookup stays sound.
      if (entry.kind === 'knowledge-document') continue
      const list = groups.get(entry.kind)
      if (list) list.push(entry)
      else groups.set(entry.kind, [entry])
    }
    return Array.from(groups, ([kind, items]) => ({
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

  // The mapping entry a dependent field hangs off (its credential/KB), for change + target lookups.
  const entryForDependent = (field: ForkDependentReconfig) =>
    entriesByParent.get(`${field.parentKind}:${field.parentSourceId}`)

  // The value sent + displayed for a dependent (delegates to the shared rule): the user's
  // re-pick, else the stored value - blank when this field's parent target changed in-session.
  // Callers that already resolved the parent pass it in to skip a second lookup.
  const dependentValueFor = (
    field: ForkDependentReconfig,
    parent = entryForDependent(field)
  ): string =>
    effectiveDependentValue(
      field,
      reconfig,
      parent ? shouldReconfigureEntry(parent, targets) : false
    )

  // Every required dependent whose parent IS mapped must have a value before sync. A dependent
  // whose parent target is still empty can't be picked yet (its selector is disabled) and is
  // gated by `requiredComplete` on the parent instead, so it's skipped here.
  const reconfigComplete = dependentReconfigs.every((field) => {
    if (!field.required) return true
    const parent = entryForDependent(field)
    if (!parent || targetFor(parent) === '') return true
    return dependentValueFor(field, parent) !== ''
  })

  // Kinds with a required DEPENDENT that still has no value (its parent is mapped): these block
  // Sync via `reconfigComplete`, so the overview badge for that kind must not read "Fully mapped".
  const reconfigPendingByKind = new Set<MappableMappingKind>()
  for (const field of dependentReconfigs) {
    if (!field.required) continue
    const parent = entryForDependent(field)
    if (!parent || targetFor(parent) === '') continue
    if (dependentValueFor(field, parent) === '') {
      reconfigPendingByKind.add(parent.kind as MappableMappingKind)
    }
  }

  // The references this sync would blank, reactively narrowed to the current selection. A resource
  // is "resolved" once it has a mapping target OR is selected for copy - the same predicate drives
  // a `reference` (its own resource) and a `dependent` (its PARENT resource), so mapping or copying
  // a parent KB makes its child document drop off. Then split: `reference`/`workflow` entries are
  // BLOCKERS (Sync stays disabled while any remain - mirroring the server's zero-cleared-refs
  // gate); `dependent` entries stay informational (the reconfigure flow owns them).
  const { blockers: blockingRefs, informational: dependentClears } = useMemo(() => {
    const isResolved = (kind: string, sourceId: string) => {
      const key = `${kind}:${sourceId}`
      const entry = entriesByParent.get(key)
      const mapped = entry ? (targets[key] ?? entry.targetId ?? '') !== '' : false
      return mapped || copyingKeys.has(key)
    }
    return splitForkClearedRefs(selectVisibleClearedRefs(clearedRefs, isResolved))
  }, [clearedRefs, entriesByParent, targets, copyingKeys])

  // Per-kind status for the overview listing: "Fully mapped" or "n/total mapped",
  // flagged when a REQUIRED target is still missing (which blocks Sync). Reads the
  // effective (override-or-persisted) target so it reflects both remembered mappings
  // and in-session edits.
  const kindSummaries = groupedEntries.map((group) => {
    const total = group.items.length
    const mapped = group.items.filter((entry) => targetFor(entry) !== '').length
    // Copy-selected items are resolved too (their refs are kept), so they count toward completion
    // and render as "copied" rather than unconfigured. mapped/copied are disjoint: a mapped
    // copyable is excluded from the copy candidates, so copyingKeys never overlaps a mapped entry.
    const copied = group.items.filter((entry) => copyingKeys.has(entryKey(entry))).length
    // Mirror the Sync gate: a required ref selected for copy is satisfied, so it is not "pending".
    const requiredPending = forkRequiredPending(group.items, targets, copyingKeys)
    const reconfigPending = reconfigPendingByKind.has(group.kind)
    return {
      kind: group.kind,
      label: group.label,
      total,
      mapped,
      copied,
      requiredPending,
      reconfigPending,
    }
  })

  // Kinds whose required gate is still failing, so the Sync tooltip can name the actual
  // obstacle. An unmapped credential/secret is NEVER a cleared-ref blocker (the collector
  // excludes required kinds), so the required gate must not borrow the blocker message -
  // it would point at a "Blocking sync" section that isn't rendered.
  const pendingRequiredKinds = new Set<string>(
    kindSummaries.filter((summary) => summary.requiredPending).map((summary) => summary.kind)
  )

  // Step 0 is the overview; each subsequent step edits one resource kind, entered via
  // "Edit mappings". Reconfigure cards render inline under the changed mapping (not as
  // their own steps) so the credential/KB context stays visible. `safeStep` guards
  // against a group count that shrank on refetch.
  const stepCount = 1 + groupedEntries.length
  const safeStep = Math.min(step, Math.max(0, stepCount - 1))
  const isLastStep = safeStep >= stepCount - 1
  const currentGroup = safeStep >= 1 ? (groupedEntries[safeStep - 1] ?? null) : null
  // Sync details still settling for the current direction: loading, a failed/empty mapping
  // (`!mapping.data` must not read as "nothing required"), or the PREVIOUS direction's placeholder
  // after a switch (syncing on it would send stale mappings/copies and clear references). Until
  // `diff.data` arrives `dependentReconfigs` is empty, so `reconfigComplete` is vacuously true.
  const dataPending =
    mapping.isLoading ||
    !mapping.data ||
    mapping.isPlaceholderData ||
    !diff.data ||
    diff.isPlaceholderData
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
    dataPending
  const headsUp =
    (diff.data?.mcpReauthServerIds.length ?? 0) > 0 ||
    (diff.data?.inlineSecretSources.length ?? 0) > 0

  const runPromote = async () => {
    if (!otherWorkspaceId) return
    setSubmitting(true)
    try {
      await updateMapping.mutateAsync({
        workspaceId,
        body: {
          otherWorkspaceId,
          direction,
          entries: entries.map((entry) => ({
            resourceType: entry.resourceType,
            sourceId: entry.sourceId,
            targetId: targetFor(entry) || null,
          })),
        },
      })

      // Send the full stored mapping for every dependent whose parent is mapped (its effective
      // value - re-pick, stored, or blank-after-change). Promote persists this verbatim as the
      // stored mapping and applies it; fields whose parent isn't mapped yet are omitted (they
      // can't be configured). This is the whole "what's in the mapping goes in" contract.
      const dependentValues = dependentReconfigs.flatMap((field) => {
        const parent = entryForDependent(field)
        if (!parent || targetFor(parent) === '') return []
        return [
          {
            workflowId: field.targetWorkflowId,
            blockId: field.targetBlockId,
            subBlockKey: field.subBlockKey,
            value: dependentValueFor(field, parent),
          },
        ]
      })

      // Copy the referenced-but-unmapped resources the user kept selected, excluding any the user
      // mapped in-session (reconciliation: maps win). The backend validates each id against the
      // plan's copy candidates too, so a mapped/stale id is dropped server-side regardless.
      const selectedCopyables = visibleCopyables.filter((candidate) =>
        copySelected.has(copyableKey(candidate))
      )
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
      }

      const result = await promote.mutateAsync({
        workspaceId,
        body: {
          otherWorkspaceId,
          direction,
          // Once the diff has loaded, ALWAYS send the full effective set - including `[]`, which
          // means "every dependent went away" and must reconcile/clear the live replace targets'
          // stored rows. Collapsing `[]` into omission would make the backend PRESERVE stale rows.
          // Only omit before the diff loads (set unknown), so the existing store is left untouched.
          ...(diff.data ? { dependentValues } : {}),
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
          // gated client-side before this runs (see the Sync button's disabled tooltip).
          const kinds = new Set(result.unmappedRequired.map((reference) => reference.kind))
          toast.error(`Map all required ${forkRequiredKindsLabel(kinds)} first`)
          return
        }
        toast.error('Sync did not complete')
        return
      }

      const target = parent?.name ?? 'the workspace'
      const label = direction === 'pull' ? `Pulled from "${target}"` : `Pushed to "${target}"`
      const needsConfig = result.needsConfiguration
      const clearedOptional = result.clearedOptional
      // List the affected blocks, naming the workflow for a single one and falling back to
      // a count across many. Block names ("Gmail 2") are far more actionable than the
      // generic field titles ("Label") behind them.
      const formatWhere = (list: Array<{ workflowName: string; blocks: string[] }>) => {
        const totalBlocks = list.reduce((sum, workflow) => sum + workflow.blocks.length, 0)
        if (list.length === 1) return `${list[0].blocks.join(', ')} in ${list[0].workflowName}`
        return `${totalBlocks} block${totalBlocks === 1 ? '' : 's'} across ${list.length} workflows`
      }
      const optionalBlocks = clearedOptional.reduce(
        (sum, workflow) => sum + workflow.blocks.length,
        0
      )
      // Appended to a higher-priority warning so a cleared optional filter is never hidden.
      const optionalSuffix =
        optionalBlocks > 0
          ? ` (+${optionalBlocks} block${optionalBlocks === 1 ? '' : 's'} with optional fields cleared)`
          : ''
      // Surfaced alongside a needs-config warning too, so concurrent deploy failures aren't only in
      // logs/Activity when both happen (the needs-config branch would otherwise win alone).
      const deployFailedSuffix =
        result.deployFailed > 0
          ? ` (+${result.deployFailed} workflow${result.deployFailed === 1 ? '' : 's'} failed to deploy)`
          : ''
      if (needsConfig.length > 0) {
        toast.warning(
          `${label}. Re-check ${formatWhere(needsConfig)}.${deployFailedSuffix}${optionalSuffix}`
        )
      } else if (result.deployFailed > 0) {
        const n = result.deployFailed
        toast.warning(
          `${label}, but ${n} workflow${n === 1 ? '' : 's'} failed to deploy — open and redeploy ${n === 1 ? 'it' : 'them'}.${optionalSuffix}`
        )
      } else if (clearedOptional.length > 0) {
        toast.warning(
          `${label}. Optional settings cleared — re-check ${formatWhere(clearedOptional)}.`
        )
      } else {
        toast.success(label)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Sync failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const workflowChanges = useMemo<ForkWorkflowChange[]>(() => {
    const order: Record<ForkWorkflowChange['action'], number> = { update: 0, create: 1, archive: 2 }
    return [...(diff.data?.workflows ?? [])].sort(
      (a, b) => order[a.action] - order[b.action] || a.currentName.localeCompare(b.currentName)
    )
  }, [diff.data?.workflows])

  // Target workflows this sync archives (their source was deleted), named in the confirm modal so
  // the overwrite warning is concrete - the push-to-parent case is the high-stakes one, so the
  // target workspace is named explicitly there.
  const archivedWorkflowNames = useMemo(
    () =>
      workflowChanges
        .filter((change) => change.action === 'archive')
        .map((change) => change.currentName),
    [workflowChanges]
  )
  const targetWorkspaceName =
    direction === 'push' ? (parent?.name ?? 'the parent workspace') : 'this workspace'

  // One expandable row per copyable kind present in `byKind` - shared by the referenced group
  // and the unreferenced "Not used by any workflow" group so both render exactly like the fork
  // picker (files as a folder tree, every other kind flat).
  const renderCopyKindSections = (
    byKind: ReadonlyMap<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>
  ) =>
    COPYABLE_KIND_SECTIONS.map((section) => {
      const candidates = byKind.get(section.kind)
      if (!candidates || candidates.length === 0) return null
      // The picker rows track item ids; copy selection is keyed `${kind}:${id}`
      // (matching `copyableKey`), so derive the per-kind selected-id subset and
      // re-prefix on toggle.
      const selectedIds = new Set(
        candidates
          .filter((candidate) => copySelected.has(copyableKey(candidate)))
          .map((candidate) => candidate.sourceId)
      )
      const toggleMany = (ids: string[], checked: boolean) =>
        setCopySelected((prev) => {
          const next = new Set(prev)
          for (const id of ids) {
            const key = `${section.kind}:${id}`
            if (checked) next.add(key)
            else next.delete(key)
          }
          return next
        })
      const toggleAll = (selectAll: boolean) =>
        toggleMany(
          candidates.map((candidate) => candidate.sourceId),
          selectAll
        )
      return section.kind === 'file' ? (
        <FileKindRow
          key={section.kind}
          label={section.label}
          files={candidates.map((candidate) => ({
            id: candidate.sourceId,
            label: candidate.label,
            folderId: candidate.parentId,
            folderName: candidate.parentLabel,
          }))}
          selected={selectedIds}
          onToggleAll={toggleAll}
          onToggleItem={(id, checked) => toggleMany([id], checked)}
          onToggleMany={toggleMany}
          disabled={submitting}
        />
      ) : (
        <ResourceKindRow
          key={section.kind}
          label={section.label}
          items={candidates.map((candidate) => ({
            id: candidate.sourceId,
            label: candidate.label,
          }))}
          selected={selectedIds}
          onToggleMany={toggleMany}
          onToggleItem={(id, checked) => toggleMany([id], checked)}
          disabled={submitting}
        />
      )
    })

  // Right-cluster action sitting immediately left of the primary. The overview pairs
  // "Edit mappings" with Sync (entering the step walk); every editing step pairs Back
  // with Next (or with Sync on the last step). Back out of step 1 lands on the
  // overview, restoring the "Edit mappings · Sync" pair.
  const syncPrimaryAdjacent: ChipModalFooterSlotAction | undefined =
    safeStep === 0
      ? groupedEntries.length > 0
        ? { label: 'Edit mappings', onClick: () => setStep(1), disabled: submitting }
        : undefined
      : { label: 'Back', onClick: () => setStep(safeStep - 1), disabled: submitting }

  return (
    <>
      <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Sync workspace'>
        <ChipModalHeader onClose={() => onOpenChange(false)}>
          {currentGroup ? `Sync workspace: ${currentGroup.label}` : 'Sync workspace'}
        </ChipModalHeader>
        <ChipModalBody>
          {safeStep === 0 ? (
            <div className='flex flex-col gap-7 px-2'>
              <SettingsSection label='Sync'>
                <ChipDropdown
                  value={selectedKey}
                  onChange={setSelectedKey}
                  options={edgeOptions}
                  placeholder='Select action'
                  align='start'
                  fullWidth
                />
              </SettingsSection>

              {/* Surface a failed/pending fetch so the modal never renders blank below the picker. */}
              {mapping.isError || diff.isError ? (
                <SettingsSection label='Sync details'>
                  <div className='text-[var(--text-error)] text-small'>
                    {getErrorMessage(
                      mapping.error ?? diff.error,
                      "Couldn't load sync details. Close and reopen to retry."
                    )}
                  </div>
                </SettingsSection>
              ) : !diff.data ? (
                <div className='text-[var(--text-muted)] text-small'>Loading sync details…</div>
              ) : null}

              {/* Always shown once the diff loads so the user sees the section even with nothing
                  deployed - an empty change list means the source has no deployed workflows (every
                  deployed workflow appears here, changed or not), so the muted state nudges a deploy. */}
              {diff.data ? (
                <SettingsSection label='Deployed Workflows'>
                  {workflowChanges.length > 0 ? (
                    <div className='flex max-h-40 flex-col gap-1 overflow-y-auto'>
                      {workflowChanges.map((change, index) => {
                        const renamed = change.currentName !== change.otherName
                        return (
                          <div
                            key={`${change.action}:${change.currentName}:${index}`}
                            className='flex min-w-0 items-center gap-1.5'
                          >
                            <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>
                              {change.currentName}
                            </span>
                            {renamed ? (
                              <>
                                <ArrowRight className='size-3 shrink-0 text-[var(--text-icon)]' />
                                <span className='min-w-0 truncate text-[var(--text-secondary)] text-sm'>
                                  {change.otherName}
                                </span>
                              </>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className='text-[var(--text-muted)] text-small'>
                      {direction === 'push'
                        ? `No deployed workflows. Deploy workflows to push changes to ${parent?.name ?? 'the parent'}.`
                        : `No deployed workflows in ${parent?.name ?? 'the parent'} to pull.`}
                    </div>
                  )}
                </SettingsSection>
              ) : null}

              {headsUp ? (
                <SettingsSection label='Heads up'>
                  {(diff.data?.mcpReauthServerIds.length ?? 0) > 0 ? (
                    <div className='text-[var(--text-muted)] text-small'>
                      {diff.data?.mcpReauthServerIds.length} MCP server(s) use OAuth and must be
                      re-authorized in the target workspace.
                    </div>
                  ) : null}
                  {(diff.data?.inlineSecretSources.length ?? 0) > 0 ? (
                    <div className='mt-1 text-[var(--text-muted)] text-small'>
                      {diff.data?.inlineSecretSources.length} inline secret(s) can't be auto-mapped
                      — set them in the target workspace.
                    </div>
                  ) : null}
                </SettingsSection>
              ) : null}

              {kindSummaries.length > 0 ? (
                <SettingsSection label='Mappings'>
                  <div className='flex flex-col gap-2'>
                    {kindSummaries.map(
                      ({
                        kind,
                        label,
                        total,
                        mapped,
                        copied,
                        requiredPending,
                        reconfigPending,
                      }) => {
                        const resolved = mapped + copied
                        const complete = resolved === total && !reconfigPending
                        const badgeLabel = complete
                          ? mapped === total
                            ? 'Fully mapped'
                            : copied === total
                              ? 'Copied'
                              : 'Mapped & copied'
                          : reconfigPending && resolved === total
                            ? 'Needs setup'
                            : copied > 0
                              ? `${resolved}/${total} ready`
                              : `${mapped}/${total} mapped`
                        return (
                          <div key={kind} className='flex items-center justify-between gap-2'>
                            <span className='text-[var(--text-body)] text-small'>{label}</span>
                            <Badge
                              variant={
                                complete
                                  ? 'green'
                                  : requiredPending || reconfigPending
                                    ? 'amber'
                                    : 'gray-secondary'
                              }
                              size='sm'
                              dot
                            >
                              {badgeLabel}
                            </Badge>
                          </div>
                        )
                      }
                    )}
                  </div>
                </SettingsSection>
              ) : null}

              {syncBlocked ? (
                <SettingsSection label='Blocking sync'>
                  <div className='flex max-h-40 flex-col gap-1 overflow-y-auto'>
                    {blockingRefs.map((ref, index) => (
                      <div
                        key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                        className='min-w-0 text-[var(--text-secondary)] text-small'
                      >
                        <span className='text-[var(--text-body)]'>{ref.blockLabel}</span> would lose{' '}
                        <span className='text-[var(--text-body)]'>{ref.fieldLabel}</span> in{' '}
                        {ref.workflowName} — {forkBlockerResolution(ref)}
                      </div>
                    ))}
                  </div>
                  <p className='text-[var(--text-muted)] text-caption'>
                    Sync is blocked while any of these remain, so every synced workflow stays fully
                    operational in the target.
                  </p>
                </SettingsSection>
              ) : null}

              {dependentClears.length > 0 ? (
                <SettingsSection label='Will be cleared'>
                  <div className='flex max-h-40 flex-col gap-1 overflow-y-auto'>
                    {dependentClears.map((ref, index) => (
                      <div
                        key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                        className='min-w-0 text-[var(--text-secondary)] text-small'
                      >
                        <span className='text-[var(--text-body)]'>{ref.blockLabel}</span> will lose{' '}
                        <span className='text-[var(--text-body)]'>{ref.fieldLabel}</span> in{' '}
                        {ref.workflowName}
                      </div>
                    ))}
                  </div>
                  <p className='text-[var(--text-muted)] text-caption'>
                    Fields that hang off a remapped credential or knowledge base are cleared —
                    re-pick them in the target after the sync.
                  </p>
                </SettingsSection>
              ) : null}

              {visibleCopyables.length > 0 ? (
                <SettingsSection label='Copy resources'>
                  <div className='flex flex-col gap-2'>
                    {referencedByKind.size > 0 ? (
                      <>
                        {renderCopyKindSections(referencedByKind)}
                        <p className='text-[var(--text-muted)] text-caption'>
                          These referenced resources aren't in the target yet. Selected ones are
                          copied during the sync; a deselected one blocks the sync until it's mapped
                          or selected again.
                        </p>
                      </>
                    ) : null}
                    {unreferencedByKind.size > 0 ? (
                      <>
                        <div
                          className={cn(
                            'text-[var(--text-muted)] text-small',
                            referencedByKind.size > 0 && 'mt-1'
                          )}
                        >
                          Not used by any workflow
                        </div>
                        {renderCopyKindSections(unreferencedByKind)}
                        <p className='text-[var(--text-muted)] text-caption'>
                          These aren't referenced by any synced workflow. Selected ones are copied
                          during the sync; deselected ones are simply left out.
                        </p>
                      </>
                    ) : null}
                  </div>
                </SettingsSection>
              ) : null}
            </div>
          ) : currentGroup ? (
            <div className='flex flex-col gap-7 px-2'>
              {currentGroup.items.map((entry) => {
                // On push, a parent target can back only one source; disable any target
                // another source already took (named in the hint) so the user can't create a
                // mapping that would be silently dropped on save. Pull allows sharing a target.
                const takenOwners =
                  direction === 'push'
                    ? takenTargetOwners(currentGroup.items, targets, entry)
                    : EMPTY_TARGET_OWNERS
                return (
                  <SettingsSection key={entryKey(entry)} label={entry.sourceLabel}>
                    <ChipCombobox
                      className='w-full'
                      options={[
                        // Let the user revert a name-match suggestion (or any in-session map) of a
                        // copyable resource back to the copy flow - clears the target via onSelect.
                        ...(copyableKeys.has(entryKey(entry)) && targetFor(entry) !== ''
                          ? [
                              {
                                label: 'Copy instead',
                                value: COPY_INSTEAD_VALUE,
                                onSelect: () => applyTargetChange(entry, ''),
                              },
                            ]
                          : []),
                        ...entry.candidates.map((candidate) => {
                          const owner = takenOwners.get(candidate.id)
                          return {
                            label: owner
                              ? `${candidate.label} · mapped to ${owner}`
                              : candidate.label,
                            value: candidate.id,
                            disabled: owner !== undefined,
                          }
                        }),
                      ]}
                      value={targetFor(entry) || undefined}
                      onChange={(value) => applyTargetChange(entry, value)}
                      placeholder='Select target'
                    />
                    {entry.candidatesTruncated ? (
                      <div className='mt-1 text-[var(--text-muted)] text-small'>
                        This workspace has more options than shown here. If you don't see the right
                        one, narrow it down by name.
                      </div>
                    ) : null}
                    {copyingKeys.has(entryKey(entry)) ? (
                      <div className='mt-1 text-[var(--text-muted)] text-small'>
                        Selected for copy in the overview — it'll be copied into the target. Pick a
                        target above to map it to an existing one instead.
                      </div>
                    ) : null}
                    {/* Always-on: every workflow this resource is used in, each expandable to
                        its blocks + dependent selectors (a plain row when nothing to configure). */}
                    <ResourceReconfigure
                      workflows={usagesForEntry(entry)}
                      dependents={dependentsForEntry(entry)}
                      parentTargetValue={targetFor(entry)}
                      parentChanged={shouldReconfigureEntry(entry, targets)}
                      workspaceId={diff.data?.targetWorkspaceId ?? ''}
                      reconfig={reconfig}
                      setReconfig={setReconfig}
                    />
                  </SettingsSection>
                )
              })}
            </div>
          ) : null}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          hideCancel
          primaryAdjacentAction={syncPrimaryAdjacent}
          primaryAction={
            safeStep >= 1 && !isLastStep
              ? { label: 'Next', onClick: () => setStep(safeStep + 1), disabled: submitting }
              : {
                  label: submitting ? 'Working...' : 'Sync',
                  onClick: () => setConfirmSyncOpen(true),
                  disabled: syncDisabled,
                  // Priority mirrors the resolution flow: clear the blockers, map the required
                  // resources, reconfigure their dependents - each failing gate names ITS
                  // obstacle (an unmapped credential/secret is a required-mapping failure, not
                  // a cleared-ref blocker; see `pendingRequiredKinds`).
                  disabledTooltip: syncBlocked
                    ? 'Resolve every blocking reference first — map it, copy it, or fix it in the source'
                    : !requiredComplete
                      ? `Map all required ${forkRequiredKindsLabel(pendingRequiredKinds)} first`
                      : !reconfigComplete
                        ? 'Reconfigure all required fields first'
                        : dataPending
                          ? 'Loading sync details…'
                          : undefined,
                }
          }
        />
      </ChipModal>

      <ChipConfirmModal
        open={confirmSyncOpen}
        onOpenChange={setConfirmSyncOpen}
        srTitle='Sync workspace'
        title='Overwrite target workspace'
        text={[
          'The target may have been modified since the last sync. Syncing will ',
          { text: 'overwrite any changes', bold: true },
          ' there. Continue?',
        ]}
        confirm={{
          label: 'Sync',
          onClick: () => {
            setConfirmSyncOpen(false)
            void runPromote()
          },
          pending: submitting,
          pendingLabel: 'Syncing...',
        }}
      >
        {archivedWorkflowNames.length > 0 ? (
          <div className='flex flex-col gap-1 px-2'>
            <p className='break-words text-[var(--text-primary)] text-sm'>
              Will be archived in <span className='font-medium'>{targetWorkspaceName}</span>{' '}
              (deleted in the source):
            </p>
            {archivedWorkflowNames.slice(0, ARCHIVED_PREVIEW_LIMIT).map((name, index) => (
              <div
                key={`${name}:${index}`}
                className='min-w-0 truncate text-[var(--text-muted)] text-small'
              >
                {name}
              </div>
            ))}
            {archivedWorkflowNames.length > ARCHIVED_PREVIEW_LIMIT ? (
              <div className='text-[var(--text-muted)] text-small'>
                and {archivedWorkflowNames.length - ARCHIVED_PREVIEW_LIMIT} more
              </div>
            ) : null}
          </div>
        ) : null}
      </ChipConfirmModal>
    </>
  )
}
