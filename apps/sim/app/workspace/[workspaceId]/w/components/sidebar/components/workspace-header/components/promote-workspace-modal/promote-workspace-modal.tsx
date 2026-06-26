'use client'

import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight } from 'lucide-react'
import {
  Badge,
  Chip,
  ChipCombobox,
  ChipConfirmModal,
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  type ChipModalFooterSlotAction,
  ChipModalHeader,
  Tooltip,
  toast,
} from '@/components/emcn'
import type {
  ForkLineageNodeApi,
  ForkMappingEntry,
  ForkWorkflowChange,
} from '@/lib/api/contracts/workspace-fork'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  type ForkDirection,
  useForkDiff,
  useForkMapping,
  usePromoteFork,
  useRollbackFork,
  useUpdateForkMapping,
} from '@/hooks/queries/workspace-fork'

interface PromoteWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /** 'sync' pushes/pulls along the parent edge; 'manage' lists this workspace's forks. */
  mode: 'sync' | 'manage'
  parent: ForkLineageNodeApi | null
  childWorkspaces: ForkLineageNodeApi[]
  undoableRun: { otherWorkspaceId: string; otherName: string; direction: ForkDirection } | null
}

const entryKey = (entry: ForkMappingEntry) => `${entry.kind}:${entry.sourceId}`

/** Join "N label" segments with " · ", dropping any zero counts so toasts never read "0 foo". */
function summarizeCounts(parts: Array<[number, string]>): string {
  return parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(' · ')
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
 * Fork sync surface. From a fork (has a parent) it force pushes/pulls along the
 * parent edge: the overview picks a direction and lists each resource kind's
 * mapping status, then Sync. "Edit mappings" steps through every kind (Back/Next,
 * each source a settings-style section + full-width target) to set or review
 * targets before landing back on Sync - with a force-confirm on drift. From a fork
 * root (no parent) it lists the forks for management. Either way, the last sync into
 * this workspace can be rolled back to its prior deployed versions.
 */
export function PromoteWorkspaceModal({
  open,
  onOpenChange,
  workspaceId,
  mode,
  parent,
  childWorkspaces,
  undoableRun,
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
  // Wizard step: 0 is the overview; 1..N edit one resource kind each, entered via
  // "Edit mappings". Backing out of step 1 returns to the overview.
  const [step, setStep] = useState(0)
  const [confirmDriftOpen, setConfirmDriftOpen] = useState(false)
  const [confirmRollbackOpen, setConfirmRollbackOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const rollback = useRollbackFork()

  useEffect(() => {
    if (open) setSelectedKey(edgeOptions[0]?.value ?? '')
  }, [open, edgeOptions])

  // Restart at the overview and drop in-session overrides whenever it (re)opens or
  // the direction changes - the mapping set, and therefore the steps, depend on the
  // direction.
  useEffect(() => {
    setStep(0)
    setTargets({})
  }, [open, selectedKey])

  const selected = edgeOptions.find((option) => option.value === selectedKey)
  const otherWorkspaceId = selected?.otherWorkspaceId
  const direction = selected?.direction ?? 'push'
  // 'manage' lists this workspace's forks; 'sync' pushes/pulls along the parent edge.
  // A mid-chain workspace (a fork that itself has forks) supports both, chosen by
  // which menu entry opened the modal.
  const isManage = mode === 'manage'

  const mapping = useForkMapping({ workspaceId, otherWorkspaceId, direction, enabled: open })
  const diff = useForkDiff({ workspaceId, otherWorkspaceId, direction, enabled: open })
  const updateMapping = useUpdateForkMapping()
  const promote = usePromoteFork()

  const entries = useMemo(() => mapping.data?.entries ?? [], [mapping.data])

  // Effective target for an entry: the user's in-session override if present,
  // else the persisted mapping from the server. Read directly from `entries` so
  // a reopened edge reflects stored mappings without a seeding effect.
  const targetFor = (entry: ForkMappingEntry) => targets[entryKey(entry)] ?? entry.targetId ?? ''

  const requiredComplete = entries.every((entry) => !entry.required || targetFor(entry) !== '')

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

  // Step 0 is the overview (direction, deployed-workflow preview, mapping status);
  // each subsequent step edits one resource kind, entered via "Edit mappings".
  // `safeStep` guards against a group count that shrank on refetch.
  const stepCount = isManage ? 1 : 1 + groupedEntries.length
  const safeStep = Math.min(step, Math.max(0, stepCount - 1))
  const isLastStep = safeStep >= stepCount - 1
  const currentGroup = !isManage && safeStep >= 1 ? (groupedEntries[safeStep - 1] ?? null) : null
  const syncDisabled = submitting || !otherWorkspaceId || !requiredComplete || mapping.isLoading
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

      const result = await promote.mutateAsync({
        workspaceId,
        body: { otherWorkspaceId, direction, force },
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

      toast.success(
        summarizeCounts([
          [result.updated, 'updated'],
          [result.created, 'created'],
          [result.archived, 'archived'],
          [result.redeployed, 'redeployed'],
        ]) || 'Sync complete'
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Sync failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const runRollback = async () => {
    if (!undoableRun) return
    setSubmitting(true)
    try {
      const result = await rollback.mutateAsync({
        workspaceId,
        body: { otherWorkspaceId: undoableRun.otherWorkspaceId },
      })
      const summary = summarizeCounts([
        [result.restored, 'restored'],
        [result.archived, 'removed'],
        [result.unarchived, 'unarchived'],
        [result.skipped, 'skipped'],
      ])
      toast.success(summary ? `Undone · ${summary}` : 'Undone')
      setConfirmRollbackOpen(false)
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Undo failed'))
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

  // Rollback is a destructive "undo the last sync into this workspace". It lives in
  // the footer's left slot - on the Overview step in Sync mode (a leaf fork that
  // pulled has no Manage modal, so this is its only undo path) and always in Manage.
  const rollbackDisabled = submitting || !undoableRun
  const rollbackTooltip = undoableRun
    ? `The last sync into this workspace (from ${undoableRun.otherName}) can be undone — it restores each workflow's prior deployed version.`
    : 'No sync to roll back yet.'
  const showRollback = Boolean(undoableRun) || isManage

  const rollbackChip = (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className={rollbackDisabled ? 'inline-flex cursor-not-allowed' : 'inline-flex'}>
          <Chip
            variant='destructive'
            flush
            onClick={() => setConfirmRollbackOpen(true)}
            disabled={rollbackDisabled}
            className={rollbackDisabled ? 'pointer-events-none' : undefined}
          >
            Rollback
          </Chip>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{rollbackTooltip}</Tooltip.Content>
    </Tooltip.Root>
  )

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

  // Far-left cluster: Rollback, shown only on the overview (its only undo path for a
  // leaf fork). Editing steps keep the footer to the Back/Next (or Back/Sync) pair
  // with nothing on the left.
  const syncSecondaryActions: ChipModalFooterSlotAction[] =
    safeStep === 0 && showRollback ? [{ custom: rollbackChip }] : []

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={onOpenChange}
        srTitle={isManage ? 'Manage forks' : 'Sync workspace'}
      >
        <ChipModalHeader onClose={() => onOpenChange(false)}>
          {isManage
            ? 'Manage Forks'
            : currentGroup
              ? `Sync workspace: ${currentGroup.label}`
              : 'Sync workspace'}
        </ChipModalHeader>
        <ChipModalBody>
          {isManage ? (
            <div className='flex flex-col gap-7 px-2'>
              <SettingsSection label='Forks'>
                {childWorkspaces.length === 0 ? (
                  <div className='text-[var(--text-secondary)] text-sm'>No forks yet.</div>
                ) : (
                  <div className='flex max-h-64 flex-col gap-1 overflow-y-auto'>
                    {childWorkspaces.map((fork) => (
                      <div key={fork.id} className='truncate text-[var(--text-body)] text-sm'>
                        {fork.name}
                      </div>
                    ))}
                  </div>
                )}
              </SettingsSection>
            </div>
          ) : safeStep === 0 ? (
            <div className='flex flex-col gap-7 px-2'>
              <SettingsSection label='Sync'>
                <div className='flex flex-col gap-2'>
                  <ChipDropdown
                    value={selectedKey}
                    onChange={setSelectedKey}
                    options={edgeOptions}
                    placeholder='Select action'
                    align='start'
                    fullWidth
                  />
                  {diff.data?.drift ? (
                    <span className='text-[var(--text-muted)] text-small'>
                      Target changed since the last sync — syncing will overwrite those changes.
                    </span>
                  ) : null}
                </div>
              </SettingsSection>

              {workflowChanges.length > 0 ? (
                <SettingsSection label='Deployed Workflows'>
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
              {currentGroup.items.map((entry) => (
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
                    options={entry.candidates.map((candidate) => ({
                      label: candidate.label,
                      value: candidate.id,
                    }))}
                    value={targetFor(entry) || undefined}
                    onChange={(value) =>
                      setTargets((prev) => ({ ...prev, [entryKey(entry)]: value }))
                    }
                    placeholder='Select target'
                  />
                </SettingsSection>
              ))}
            </div>
          ) : null}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          hideCancel
          secondaryActions={
            isManage
              ? showRollback
                ? [{ custom: rollbackChip }]
                : undefined
              : syncSecondaryActions.length > 0
                ? syncSecondaryActions
                : undefined
          }
          primaryAdjacentAction={isManage ? undefined : syncPrimaryAdjacent}
          primaryAction={
            isManage
              ? { label: 'Done', onClick: () => onOpenChange(false) }
              : safeStep >= 1 && !isLastStep
                ? { label: 'Next', onClick: () => setStep(safeStep + 1), disabled: submitting }
                : {
                    label: submitting ? 'Working...' : 'Sync',
                    onClick: () => void runPromote(false),
                    disabled: syncDisabled,
                    disabledTooltip: requiredComplete
                      ? undefined
                      : 'Map all required secrets first',
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

      <ChipConfirmModal
        open={confirmRollbackOpen}
        onOpenChange={setConfirmRollbackOpen}
        srTitle='Undo last sync'
        title='Undo last sync'
        text={[
          'This restores each affected workflow to its ',
          { text: 'prior deployed version', bold: true },
          ' and removes workflows the sync created. Continue?',
        ]}
        confirm={{
          label: 'Rollback',
          onClick: () => void runRollback(),
          pending: submitting,
          pendingLabel: 'Rolling back...',
        }}
      />
    </>
  )
}
