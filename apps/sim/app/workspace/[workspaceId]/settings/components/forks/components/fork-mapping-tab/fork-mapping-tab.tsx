'use client'

import { type Dispatch, Fragment, type SetStateAction, useMemo, useState } from 'react'
import { ChevronDown, ChipCombobox, cn, FieldDivider, Label, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  ForkDependentReconfig,
  ForkMappingEntry,
  ForkResourceUsage,
} from '@/lib/api/contracts/workspace-fork'
import { DependentFieldSelector } from '@/app/workspace/[workspaceId]/settings/components/forks/components/promote-workspace-modal/components/dependent-field-selector'
import { forkRefKey } from '@/app/workspace/[workspaceId]/settings/components/forks/components/promote-workspace-modal/copy-reconciliation'
import {
  dependentKey,
  effectiveDependentValue,
} from '@/app/workspace/[workspaceId]/settings/components/forks/components/promote-workspace-modal/dependent-value'
import { useForkDiff, useForkMapping, useUpdateForkMapping } from '@/hooks/queries/workspace-fork'
import type { SelectorKey } from '@/hooks/selectors/types'

/**
 * Mappable kinds that can be a standalone mapping entry. `knowledge-document` is excluded:
 * the mapping view never emits document entries (a document rides its parent KB), so the
 * section is unreachable (mirrors the sync modal's grouping).
 */
type MappableMappingKind = Exclude<ForkMappingEntry['kind'], 'knowledge-document'>

/** Section label + display order per mapping kind (one section per kind). */
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

/** Fixed target-picker width so every mapping row's control lines up as one column (mirrors General). */
const MAPPING_TARGET_TRIGGER_CLASS = 'w-[240px] flex-shrink-0'

/**
 * Stable empty arrays so an entry with no usages/dependents keeps a constant prop
 * reference, letting ResourceReconfigure's grouping memo skip recompute across the
 * editor's frequent re-renders (mirrors the sync modal).
 */
const EMPTY_USAGES: ForkResourceUsage['workflows'] = []
const EMPTY_DEPENDENTS: ForkDependentReconfig[] = []

export interface ForkMappingGroup {
  kind: MappableMappingKind
  label: string
  items: ForkMappingEntry[]
}

export interface ForkMappingEditor {
  otherWorkspaceName: string
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  groups: ForkMappingGroup[]
  hasEntries: boolean
  /** Effective (in-session override, else persisted/suggested) target for an entry. */
  targetFor: (entry: ForkMappingEntry) => string
  setTarget: (entry: ForkMappingEntry, value: string) => void
  /** Targets already claimed by another source in the same kind, for disabling (push targets are unique). */
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
   * or it's an unconfirmed suggestion. Mirrors the sync modal's `shouldReconfigureEntry`.
   */
  parentChangedFor: (entry: ForkMappingEntry) => boolean
  /** The workspace the dependent selectors query against (the push target = the parent). */
  targetWorkspaceId: string
  /** In-session dependent re-picks, keyed by `dependentKey`. */
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
  dirty: boolean
  saving: boolean
  save: () => void
  discard: () => void
}

/**
 * Editable resource-mapping state for one fork edge. Always edits the push mapping
 * (this workspace's resources → the other's); choosing push vs pull is a sync-time
 * concern owned by the Sync modal. Tracks in-session target overrides plus dependent
 * re-picks (the workflow → block "depends on" fields fed by the diff) and persists
 * both via a single PUT (the same contract the Sync modal saves through). Push targets
 * are unique per parent, so `takenOwnersFor` disables a target another source already
 * claimed - mirroring the modal so a save can't collide on the unique index.
 */
export function useForkMappingEditor(params: {
  workspaceId: string
  otherWorkspaceId?: string
  otherWorkspaceName: string
  enabled: boolean
}): ForkMappingEditor {
  const { workspaceId, otherWorkspaceId, otherWorkspaceName, enabled } = params
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  // In-session re-picks for dependent fields, keyed by `dependentKey`. Folded into the save
  // payload's `dependentValues`, which the server persists as the stored mapping - so the
  // selection survives every future sync without re-picking (same store promote writes).
  const [reconfig, setReconfig] = useState<Record<string, string>>({})

  const mapping = useForkMapping({ workspaceId, otherWorkspaceId, direction: 'push', enabled })
  // The diff supplies the per-resource "depends on" data: which workflows use each mapped
  // resource (`resourceUsages`) and the block-level dependent selector fields under them
  // (`dependentReconfigs`), plus the target workspace those selectors query against.
  const diff = useForkDiff({ workspaceId, otherWorkspaceId, direction: 'push', enabled })
  const updateMapping = useUpdateForkMapping()

  const entries = useMemo<ForkMappingEntry[]>(() => mapping.data?.entries ?? [], [mapping.data])

  const dependentReconfigs = useMemo(
    () => diff.data?.dependentReconfigs ?? [],
    [diff.data?.dependentReconfigs]
  )
  const resourceUsages = useMemo(() => diff.data?.resourceUsages ?? [], [diff.data?.resourceUsages])

  // Group dependents by their parent (kind:sourceId) once, so each mapping entry gets a
  // STABLE `dependents` array reference - a fresh `.filter` per render would defeat
  // ResourceReconfigure's grouping memo (mirrors the sync modal).
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

  const groups = useMemo<ForkMappingGroup[]>(() => {
    const byKind = new Map<MappableMappingKind, ForkMappingEntry[]>()
    for (const entry of entries) {
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

  const targetFor = (entry: ForkMappingEntry) =>
    overrides[forkRefKey(entry)] ?? entry.targetId ?? ''

  const usagesForEntry = (entry: ForkMappingEntry): ForkResourceUsage['workflows'] =>
    resourceUsages.find(
      (usage) => usage.parentKind === entry.kind && usage.parentSourceId === entry.sourceId
    )?.workflows ?? EMPTY_USAGES

  const dependentsForEntry = (entry: ForkMappingEntry): ForkDependentReconfig[] =>
    dependentsByParent.get(forkRefKey(entry)) ?? EMPTY_DEPENDENTS

  // Whether an entry's target changed in-session (or is an unconfirmed suggestion), so its
  // dependents start blank - the old value won't resolve against the new parent. Mirrors the
  // sync modal's `shouldReconfigureEntry` so the two surfaces can't drift.
  const parentChangedFor = (entry: ForkMappingEntry): boolean => {
    const next = targetFor(entry)
    if (next === '') return false
    return entry.suggested || next !== (entry.targetId ?? '')
  }

  // Changing a parent invalidates its dependents' in-session re-picks (chosen against the
  // old target), so drop them - mirrors the sync modal's `applyTargetChange`.
  const setTarget = (entry: ForkMappingEntry, value: string) => {
    setOverrides((prev) => ({ ...prev, [forkRefKey(entry)]: value }))
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
  ): ReadonlyMap<string, string> => {
    const owners = new Map<string, string>()
    const excludeKey = forkRefKey(entry)
    for (const item of items) {
      const key = forkRefKey(item)
      if (key === excludeKey) continue
      const target = overrides[key] ?? item.targetId ?? ''
      if (target !== '') owners.set(target, item.sourceLabel)
    }
    return owners
  }

  // Dirty only on a real change from the stored/suggested target - so a freshly loaded
  // mapping (even with name-match suggestions shown) isn't dirty until the user edits.
  const targetsDirty = useMemo(
    () =>
      entries.some((entry) => {
        const key = forkRefKey(entry)
        return key in overrides && overrides[key] !== (entry.targetId ?? '')
      }),
    [entries, overrides]
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

    // Send the full stored mapping for every dependent whose parent is mapped: its effective
    // value (re-pick, stored, or blank-after-change). The server replaces the named workflows'
    // stored sets with exactly this - the same "what's shown is what's stored" contract the
    // sync modal commits through promote. Fields whose parent isn't mapped are omitted (they
    // can't be configured yet). Only built once the diff has loaded; omitted before that so
    // an early save can't wipe the store from an unknown set.
    const entriesByKey = new Map(entries.map((entry) => [forkRefKey(entry), entry]))
    const dependentValues = dependentReconfigs.flatMap((field) => {
      const parent = entriesByKey.get(`${field.parentKind}:${field.parentSourceId}`)
      if (!parent || targetFor(parent) === '') return []
      return [
        {
          workflowId: field.targetWorkflowId,
          blockId: field.targetBlockId,
          subBlockKey: field.subBlockKey,
          value: effectiveDependentValue(field, reconfig, parentChangedFor(parent)),
        },
      ]
    })

    updateMapping.mutate(
      {
        workspaceId,
        body: {
          otherWorkspaceId,
          direction: 'push',
          // Persist the full effective set (WYSIWYG), matching the Sync modal's save.
          entries: entries.map((entry) => ({
            resourceType: entry.resourceType,
            sourceId: entry.sourceId,
            targetId: targetFor(entry) || null,
          })),
          ...(diff.data ? { dependentValues } : {}),
        },
      },
      {
        onSuccess: () => {
          setOverrides({})
          setReconfig({})
          toast.success('Mapping saved')
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to save mapping')),
      }
    )
  }

  const discard = () => {
    setOverrides({})
    setReconfig({})
  }

  return {
    otherWorkspaceName,
    isLoading: enabled && mapping.isLoading,
    isError: mapping.isError,
    errorMessage: mapping.isError ? getErrorMessage(mapping.error, 'Failed to load mapping') : null,
    groups,
    hasEntries: entries.length > 0,
    targetFor,
    setTarget,
    takenOwnersFor,
    usagesForEntry,
    dependentsForEntry,
    parentChangedFor,
    targetWorkspaceId: diff.data?.targetWorkspaceId ?? '',
    reconfig,
    setReconfig,
    dirty,
    saving: updateMapping.isPending,
    save,
    discard,
  }
}

interface DependentBlock {
  targetBlockId: string
  blockName: string
  fields: ForkDependentReconfig[]
}

interface WorkflowDependents {
  workflowId: string
  workflowName: string
  blocks: DependentBlock[]
}

/**
 * Bucket an entry's dependents per workflow, then per block within it - the
 * workflow → block hierarchy the cards render (same grouping the sync modal's
 * reconfigure listing uses).
 */
function groupDependentsByWorkflow(
  workflows: ForkResourceUsage['workflows'],
  dependents: ForkDependentReconfig[]
): WorkflowDependents[] {
  const byWorkflow = new Map<string, ForkDependentReconfig[]>()
  for (const dependent of dependents) {
    const list = byWorkflow.get(dependent.targetWorkflowId)
    if (list) list.push(dependent)
    else byWorkflow.set(dependent.targetWorkflowId, [dependent])
  }
  return workflows.map((workflow) => {
    const byBlock = new Map<string, DependentBlock>()
    for (const field of byWorkflow.get(workflow.workflowId) ?? []) {
      let block = byBlock.get(field.targetBlockId)
      if (!block) {
        block = { targetBlockId: field.targetBlockId, blockName: field.blockName, fields: [] }
        byBlock.set(field.targetBlockId, block)
      }
      block.fields.push(field)
    }
    return {
      workflowId: workflow.workflowId,
      workflowName: workflow.workflowName,
      blocks: Array.from(byBlock.values()).sort((a, b) => a.blockName.localeCompare(b.blockName)),
    }
  })
}

interface WorkflowDependentsRowProps {
  workflow: WorkflowDependents
  parentTargetValue: string
  parentChanged: boolean
  workspaceId: string
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
}

/**
 * One workflow's dependent fields as a chevron-expandable row - the same header row
 * the fork picker's `ResourceKindRow` uses (name + rotating chevron, indented body),
 * so it reads as obviously clickable. The body is one labeled `DependentFieldSelector`
 * per block field ("Block · Field"). Starts expanded when a required field is present
 * (required fields are what gate a sync), mirroring the sync modal's auto-open.
 * In-block chaining matches the modal: a field that provides a SelectorContext key
 * feeds its effective value to its in-block descendants, and a re-pick invalidates
 * their stale selections.
 */
function WorkflowDependentsRow({
  workflow,
  parentTargetValue,
  parentChanged,
  workspaceId,
  reconfig,
  setReconfig,
}: WorkflowDependentsRowProps) {
  const [expanded, setExpanded] = useState(() =>
    workflow.blocks.some((block) => block.fields.some((field) => field.required))
  )

  const effectiveValue = (field: ForkDependentReconfig) =>
    effectiveDependentValue(field, reconfig, parentChanged)

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-2 text-[var(--text-body)] text-sm'>
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-1 text-left hover:text-[var(--text-primary)]'
          onClick={() => setExpanded((value) => !value)}
        >
          <span className='min-w-0 flex-1 truncate'>{workflow.workflowName}</span>
          <ChevronDown
            className={cn(
              'h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </div>

      {expanded ? (
        <div className='ml-6 flex flex-col gap-2'>
          {workflow.blocks.map((block) => {
            // Chain re-picks: a field that provides a SelectorContext key feeds its effective
            // value to its in-block descendants (a spreadsheet drives the sheet selector).
            const providedValues: Record<string, string> = {}
            const providedContextKeys = new Set<string>()
            for (const field of block.fields) {
              if (field.providesContextKey) {
                providedContextKeys.add(field.providesContextKey)
                const value = effectiveValue(field)
                if (value) providedValues[field.providesContextKey] = value
              }
            }
            return (
              <Fragment key={block.targetBlockId}>
                {block.fields.map((field) => {
                  // Disabled until the parent target is set AND every in-block parent it
                  // depends on has a value, so a child never queries a stale upstream value.
                  const ready = field.consumesContextKeys.every(
                    (key) => !providedContextKeys.has(key) || providedValues[key] !== undefined
                  )
                  return (
                    <Fragment key={dependentKey(field)}>
                      <Label className='text-small'>
                        {block.blockName} · {field.title}
                        {field.required ? (
                          <span className='text-[var(--text-error)]'>*</span>
                        ) : null}
                      </Label>
                      <DependentFieldSelector
                        selectorKey={field.selectorKey as SelectorKey}
                        context={{
                          ...field.context,
                          ...providedValues,
                          // Target workspace, for workspace-scoped selectors like table.columns.
                          workspaceId,
                          [field.parentContextKey]: parentTargetValue,
                        }}
                        enabled={parentTargetValue !== '' && ready}
                        value={effectiveValue(field)}
                        onChange={(value) =>
                          setReconfig((prev) => {
                            const nextState = { ...prev, [dependentKey(field)]: value }
                            // A changed parent invalidates its children's stale re-picks.
                            const providedKey = field.providesContextKey
                            if (providedKey) {
                              for (const sibling of block.fields) {
                                if (sibling.consumesContextKeys.includes(providedKey)) {
                                  delete nextState[dependentKey(sibling)]
                                }
                              }
                            }
                            return nextState
                          })
                        }
                        title={field.title}
                      />
                    </Fragment>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The rows for ONE mapping category (source label ↔ target picker), rendered as a
 * category tab's panel in the fork detail view. Beneath each row sits the always-on
 * "depends on" listing from the sync modal: every workflow the resource is used in,
 * a chevron row (the fork picker's row style) expanding to its blocks' dependent
 * selectors (Gmail label, KB document, sheet tab, ...) so they can be (re)configured
 * at the workflow → block level; workflows with nothing to configure list as a muted
 * caption. Entries are separated by the standard `FieldDivider`. The tab bar,
 * loading/empty states, and Save/Discard header actions are owned by the caller.
 */
export function ForkMappingCategoryPanel({
  editor,
  group,
}: {
  editor: ForkMappingEditor
  group: ForkMappingGroup
}) {
  const {
    targetFor,
    setTarget,
    takenOwnersFor,
    usagesForEntry,
    dependentsForEntry,
    parentChangedFor,
    targetWorkspaceId,
    reconfig,
    setReconfig,
  } = editor

  return (
    <div className='flex flex-col'>
      {group.items.map((entry, index) => {
        const takenOwners = takenOwnersFor(entry, group.items)
        const workflowDependents = groupDependentsByWorkflow(
          usagesForEntry(entry),
          dependentsForEntry(entry)
        )
        const configurable = workflowDependents.filter((workflow) => workflow.blocks.length > 0)
        const usedOnly = workflowDependents.filter((workflow) => workflow.blocks.length === 0)
        return (
          <Fragment key={forkRefKey(entry)}>
            {index > 0 ? <FieldDivider /> : null}
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between gap-4'>
                <Label className='min-w-0 truncate'>{entry.sourceLabel}</Label>
                <div className={MAPPING_TARGET_TRIGGER_CLASS}>
                  <ChipCombobox
                    className='w-full'
                    align='start'
                    options={entry.candidates.map((candidate) => {
                      const owner = takenOwners.get(candidate.id)
                      return {
                        label: owner ? `${candidate.label} · mapped to ${owner}` : candidate.label,
                        value: candidate.id,
                        disabled: owner !== undefined,
                      }
                    })}
                    value={targetFor(entry) || undefined}
                    onChange={(value) => setTarget(entry, value)}
                    placeholder='Select target'
                  />
                </div>
              </div>
              {entry.candidatesTruncated ? (
                <p className='text-[var(--text-muted)] text-small'>
                  This workspace has more options than shown here. If you don't see the right one,
                  narrow it down by name.
                </p>
              ) : null}
              {configurable.map((workflow) => (
                <WorkflowDependentsRow
                  key={workflow.workflowId}
                  workflow={workflow}
                  parentTargetValue={targetFor(entry)}
                  parentChanged={parentChangedFor(entry)}
                  workspaceId={targetWorkspaceId}
                  reconfig={reconfig}
                  setReconfig={setReconfig}
                />
              ))}
              {usedOnly.length > 0 ? (
                <p className='text-[var(--text-tertiary)] text-caption'>
                  Also used in {usedOnly.map((workflow) => workflow.workflowName).join(', ')} —
                  nothing to configure there.
                </p>
              ) : null}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
