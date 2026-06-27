'use client'

import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight } from 'lucide-react'
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
  toast,
} from '@/components/emcn'
import type {
  ForkDependentReconfig,
  ForkLineageNodeApi,
  ForkMappingEntry,
  ForkWorkflowChange,
} from '@/lib/api/contracts/workspace-fork'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { DependentFieldSelector } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/components/dependent-field-selector'
import {
  type ForkDirection,
  useForkDiff,
  useForkMapping,
  usePromoteFork,
  useUpdateForkMapping,
} from '@/hooks/queries/workspace-fork'
import type { SelectorKey } from '@/hooks/selectors/types'

interface PromoteWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  parent: ForkLineageNodeApi | null
}

const entryKey = (entry: ForkMappingEntry) => `${entry.kind}:${entry.sourceId}`

/** Stable key for a per-target dependent re-pick (target workflow + block + subblock). */
const dependentKey = (dependent: ForkDependentReconfig) =>
  `${dependent.targetWorkflowId}:${dependent.targetBlockId}:${dependent.subBlockKey}`

/** One block's worth of dependent fields to re-pick after its parent's target changed. */
interface ReconfigBlock {
  targetBlockId: string
  blockName: string
  fields: ForkDependentReconfig[]
}

/** Group dependent re-picks by their target block, sorted by block name, for inline render. */
function groupDependentsByBlock(dependents: ForkDependentReconfig[]): ReconfigBlock[] {
  const byBlock = new Map<string, ReconfigBlock>()
  for (const dependent of dependents) {
    let block = byBlock.get(dependent.targetBlockId)
    if (!block) {
      block = { targetBlockId: dependent.targetBlockId, blockName: dependent.blockName, fields: [] }
      byBlock.set(dependent.targetBlockId, block)
    }
    block.fields.push(dependent)
  }
  return Array.from(byBlock.values()).sort((a, b) => a.blockName.localeCompare(b.blockName))
}

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

/** Section label + display order per mapping kind (one mapping step per kind). */
const MAPPING_SECTION: Record<ForkMappingEntry['kind'], { label: string; order: number }> = {
  credential: { label: 'Credentials', order: 0 },
  'env-var': { label: 'Secrets', order: 1 },
  table: { label: 'Tables', order: 2 },
  'knowledge-base': { label: 'Knowledge bases', order: 3 },
  'knowledge-document': { label: 'Knowledge documents', order: 4 },
  file: { label: 'Files', order: 5 },
  'mcp-server': { label: 'MCP servers', order: 6 },
  'custom-tool': { label: 'Custom tools', order: 7 },
  skill: { label: 'Skills', order: 8 },
}

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
 * landing back on Sync - with a force-confirm on drift. The durable record of
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
  // In-session re-picks for dependent fields whose credential the user swapped, keyed
  // by `dependentKey`. Sent as one-shot overrides on sync; not persisted (the engine
  // preserves them on later syncs once the account is stable).
  const [reconfig, setReconfig] = useState<Record<string, string>>({})
  // Wizard step: 0 is the overview; 1..N edit one resource kind each, entered via
  // "Edit mappings". Backing out of step 1 returns to the overview.
  const [step, setStep] = useState(0)
  const [confirmDriftOpen, setConfirmDriftOpen] = useState(false)
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

  // Effective target for an entry: the user's in-session override if present,
  // else the persisted mapping from the server. Read directly from `entries` so
  // a reopened edge reflects stored mappings without a seeding effect.
  const targetFor = (entry: ForkMappingEntry) => targets[entryKey(entry)] ?? entry.targetId ?? ''

  const requiredComplete = entries.every((entry) => !entry.required || targetFor(entry) !== '')

  // Affected blocks (block-grouped dependent fields) under an entry whose target the user
  // changed - rendered inline beneath that mapping so the credential/KB stays in context.
  const reconfigBlocksForEntry = (entry: ForkMappingEntry): ReconfigBlock[] =>
    shouldReconfigureEntry(entry, targets)
      ? groupDependentsByBlock(
          dependentReconfigs.filter(
            (dependent) =>
              dependent.parentKind === entry.kind && dependent.parentSourceId === entry.sourceId
          )
        )
      : []

  // Group mappings by resource type - one step per kind, required types first.
  const groupedEntries = useMemo(() => {
    const groups = new Map<ForkMappingEntry['kind'], ForkMappingEntry[]>()
    for (const entry of entries) {
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

  // Blocks whose dependent fields need re-picking because their parent's target changed
  // in-session - the Sync gate + override collection read this. Recomputes as the user
  // edits mappings. Shares the gate/grouping with reconfigBlocksForEntry so the inline
  // cards and the Sync-gated set can never disagree.
  const reconfigBlocks = useMemo<ReconfigBlock[]>(
    () =>
      groupDependentsByBlock(
        dependentReconfigs.filter((dependent) => {
          const parent = entries.find(
            (candidate) =>
              candidate.kind === dependent.parentKind &&
              candidate.sourceId === dependent.parentSourceId
          )
          return parent != null && shouldReconfigureEntry(parent, targets)
        })
      ),
    [dependentReconfigs, entries, targets]
  )

  // Every required re-pick is filled - a required dependent left empty must not be synced.
  const reconfigComplete = reconfigBlocks.every((block) =>
    block.fields.every((field) => !field.required || (reconfig[dependentKey(field)] ?? '') !== '')
  )

  // Per-kind status for the overview listing: "Fully mapped" or "n/total mapped",
  // flagged when a REQUIRED target is still missing (which blocks Sync). Reads the
  // effective (override-or-persisted) target so it reflects both remembered mappings
  // and in-session edits.
  const kindSummaries = groupedEntries.map((group) => {
    const total = group.items.length
    const mapped = group.items.filter((entry) => targetFor(entry) !== '').length
    const requiredPending = group.items.some((entry) => entry.required && targetFor(entry) === '')
    return { kind: group.kind, label: group.label, total, mapped, requiredPending }
  })

  // Step 0 is the overview; each subsequent step edits one resource kind, entered via
  // "Edit mappings". Reconfigure cards render inline under the changed mapping (not as
  // their own steps) so the credential/KB context stays visible. `safeStep` guards
  // against a group count that shrank on refetch.
  const stepCount = 1 + groupedEntries.length
  const safeStep = Math.min(step, Math.max(0, stepCount - 1))
  const isLastStep = safeStep >= stepCount - 1
  const currentGroup = safeStep >= 1 ? (groupedEntries[safeStep - 1] ?? null) : null
  const syncDisabled =
    submitting || !otherWorkspaceId || !requiredComplete || !reconfigComplete || mapping.isLoading
  const headsUp =
    (diff.data?.mcpReauthServerIds.length ?? 0) > 0 ||
    (diff.data?.inlineSecretSources.length ?? 0) > 0

  const runPromote = async (force: boolean) => {
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

      // Send the user's pre-sync re-picks (reconfigBlocks already holds only the fields
      // whose parent's target changed; unchanged parents are preserved by the engine).
      const dependentOverrides = reconfigBlocks.flatMap((block) =>
        block.fields.flatMap((field) => {
          const value = reconfig[dependentKey(field)]
          if (!value) return []
          return [
            {
              workflowId: field.targetWorkflowId,
              blockId: field.targetBlockId,
              subBlockKey: field.subBlockKey,
              value,
            },
          ]
        })
      )

      const result = await promote.mutateAsync({
        workspaceId,
        body: {
          otherWorkspaceId,
          direction,
          force,
          ...(dependentOverrides.length > 0 ? { dependentOverrides } : {}),
        },
      })

      if (!result.promoteRunId) {
        if (result.unmappedRequired.length > 0) {
          toast.error('Map all required credentials and secrets first')
          return
        }
        if (result.drift) {
          setConfirmDriftOpen(true)
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
      if (needsConfig.length > 0) {
        toast.warning(`${label}. Re-check ${formatWhere(needsConfig)}.${optionalSuffix}`)
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
                    {kindSummaries.map(({ kind, label, total, mapped, requiredPending }) => {
                      const complete = mapped === total
                      return (
                        <div key={kind} className='flex items-center justify-between gap-2'>
                          <span className='text-[var(--text-body)] text-small'>{label}</span>
                          <Badge
                            variant={
                              complete ? 'green' : requiredPending ? 'amber' : 'gray-secondary'
                            }
                            size='sm'
                            dot
                          >
                            {complete ? 'Fully mapped' : `${mapped}/${total} mapped`}
                          </Badge>
                        </div>
                      )
                    })}
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
                  <SettingsSection
                    key={entryKey(entry)}
                    label={entry.sourceLabel}
                    headerAccessory={
                      entry.required ? (
                        <span className='text-[var(--text-error)]' title='Required to sync'>
                          *
                        </span>
                      ) : undefined
                    }
                  >
                    <ChipCombobox
                      className='w-full'
                      options={entry.candidates.map((candidate) => {
                        const owner = takenOwners.get(candidate.id)
                        return {
                          label: owner
                            ? `${candidate.label} · mapped to ${owner}`
                            : candidate.label,
                          value: candidate.id,
                          disabled: owner !== undefined,
                        }
                      })}
                      value={targetFor(entry) || undefined}
                      onChange={(value) =>
                        setTargets((prev) => ({ ...prev, [entryKey(entry)]: value }))
                      }
                      placeholder='Select target'
                    />
                    {entry.candidatesTruncated ? (
                      <div className='mt-1 text-[var(--text-muted)] text-small'>
                        This workspace has more options than shown here. If you don't see the right
                        one, narrow it down by name.
                      </div>
                    ) : null}
                    {/* Account changed: re-pick its dependent fields in place, block by block. */}
                    {reconfigBlocksForEntry(entry).map((block) => {
                      // Chain re-picks: a re-picked field feeds its SelectorContext key to its
                      // in-block descendants (e.g. a new spreadsheet drives the sheet selector),
                      // so deeper selectors query against the user's new upstream choice.
                      const providedValues: Record<string, string> = {}
                      const providerByKey = new Map<string, string>()
                      for (const field of block.fields) {
                        const picked = reconfig[dependentKey(field)]
                        if (field.providesContextKey) {
                          providerByKey.set(field.providesContextKey, dependentKey(field))
                          if (picked) providedValues[field.providesContextKey] = picked
                        }
                      }
                      return (
                        <div
                          key={block.targetBlockId}
                          className='mt-3 flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3'
                        >
                          <span className='font-medium text-[var(--text-secondary)] text-small'>
                            {block.blockName}
                          </span>
                          {block.fields.map((field) => {
                            // Disabled until the credential is set AND every in-block parent it
                            // depends on (a sibling re-pick) is chosen, so a child never queries a
                            // stale upstream value (e.g. a sheet before its spreadsheet is re-picked).
                            const ready = field.consumesContextKeys.every((key) => {
                              const providerKey = providerByKey.get(key)
                              return !providerKey || (reconfig[providerKey] ?? '') !== ''
                            })
                            return (
                              <div key={dependentKey(field)} className='flex flex-col gap-1'>
                                <span className='text-[var(--text-tertiary)] text-caption'>
                                  {field.title}
                                  {field.required ? (
                                    <span className='text-[var(--text-error)]'> *</span>
                                  ) : null}
                                </span>
                                <DependentFieldSelector
                                  selectorKey={field.selectorKey as SelectorKey}
                                  context={{
                                    ...field.context,
                                    ...providedValues,
                                    [field.parentContextKey]: targetFor(entry),
                                  }}
                                  enabled={targetFor(entry) !== '' && ready}
                                  value={reconfig[dependentKey(field)] ?? ''}
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
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
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
                  onClick: () => void runPromote(false),
                  disabled: syncDisabled,
                  disabledTooltip: !requiredComplete
                    ? 'Map all required secrets first'
                    : !reconfigComplete
                      ? 'Reconfigure all required fields first'
                      : undefined,
                }
          }
        />
      </ChipModal>

      <ChipConfirmModal
        open={confirmDriftOpen}
        onOpenChange={setConfirmDriftOpen}
        srTitle='Force sync'
        title='Target has changed'
        text={[
          'The target workspace was modified since the last sync. Force syncing will ',
          { text: 'overwrite those changes', bold: true },
          '. Continue?',
        ]}
        confirm={{
          label: 'Force sync',
          onClick: () => {
            setConfirmDriftOpen(false)
            void runPromote(true)
          },
          pending: submitting,
          pendingLabel: 'Syncing...',
        }}
      />
    </>
  )
}
