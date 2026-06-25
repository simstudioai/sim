'use client'

import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight } from 'lucide-react'
import {
  Chip,
  ChipCombobox,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Tooltip,
  toast,
} from '@/components/emcn'
import type {
  ForkLineageNodeApi,
  ForkMappingEntry,
  ForkWorkflowChange,
} from '@/lib/api/contracts/workspace-fork'
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

/** Section label + display order per mapping kind (grouped, Secrets-page style). */
const MAPPING_SECTION: Record<ForkMappingEntry['kind'], { label: string; order: number }> = {
  credential: { label: 'Credentials', order: 0 },
  'env-var': { label: 'Environment variables', order: 1 },
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
 * One mapping as a `display: contents` row so its cells snap into the parent grid
 * (Secrets-page grammar): source name on the left, target selector inline on the
 * right, columns aligned across every row. A required source is marked with `*`.
 */
function MappingRow({
  entry,
  value,
  onChange,
}: {
  entry: ForkMappingEntry
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className='contents'>
      <div className='flex min-w-0 items-center gap-1'>
        <span className='truncate text-[var(--text-body)] text-sm'>{entry.sourceLabel}</span>
        {entry.required ? (
          <span className='text-[var(--text-error)]' title='Required to sync'>
            *
          </span>
        ) : null}
      </div>
      <div />
      <ChipCombobox
        className='w-full'
        options={entry.candidates.map((candidate) => ({
          label: candidate.label,
          value: candidate.id,
        }))}
        value={value || undefined}
        onChange={onChange}
        placeholder='Select target'
      />
    </div>
  )
}

/**
 * Fork sync surface. From a fork (has a parent) it runs a force push/pull along the
 * parent edge: pick a direction, map required secrets and optional resources,
 * preview the per-workflow change set, and sync - with a force-confirm on drift.
 * From a fork root (no parent) it lists the forks for management. Either way, the
 * last sync into this workspace can be rolled back to its prior deployed versions.
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
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [confirmDriftOpen, setConfirmDriftOpen] = useState(false)
  const [confirmRollbackOpen, setConfirmRollbackOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const rollback = useRollbackFork()

  useEffect(() => {
    if (open) {
      setSelectedKey(edgeOptions[0]?.value ?? '')
      setTargets({})
    }
  }, [open, edgeOptions])

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

  // Seed defaults for newly-seen entries and prune entries that no longer exist,
  // but preserve targets the user has already chosen - a background refetch of the
  // same edge must not clobber in-progress mapping edits.
  useEffect(() => {
    setTargets((prev) => {
      const next: Record<string, string> = {}
      for (const entry of entries) {
        const key = entryKey(entry)
        next[key] = key in prev ? prev[key] : (entry.targetId ?? '')
      }
      return next
    })
  }, [entries])

  const requiredComplete = entries.every(
    (entry) => !entry.required || (targets[entryKey(entry)] ?? '') !== ''
  )

  // Group mappings by resource type into Secrets-page-style sections: the section
  // header conveys the type (no per-row icons), required types sort to the top.
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
            targetId: targets[entryKey(entry)] || null,
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
        `${result.updated} updated · ${result.created} created · ${result.archived} archived` +
          (result.redeployed > 0 ? ` · ${result.redeployed} redeployed` : '')
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
      toast.success(
        `Undone · ${result.restored} restored · ${result.archived} removed · ${result.unarchived} unarchived`
      )
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

  // Rollback lives in the footer (left-docked, like a destructive "Delete"). It's
  // a custom slot so the explanatory text shows as a tooltip in BOTH states - the
  // footer's declarative `disabledTooltip` only covers the greyed state.
  const rollbackDisabled = submitting || !undoableRun
  const rollbackTooltip = undoableRun
    ? `The last sync into this workspace (from ${undoableRun.otherName}) can be undone — it restores each workflow's prior deployed version.`
    : 'No sync to roll back yet.'
  const showRollback = Boolean(undoableRun) || isManage

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={onOpenChange}
        srTitle={isManage ? 'Manage forks' : 'Sync workspace'}
      >
        <ChipModalHeader onClose={() => onOpenChange(false)}>
          {isManage ? 'Manage Forks' : 'Sync workspace'}
        </ChipModalHeader>
        <ChipModalBody>
          {isManage ? (
            <ChipModalField type='custom' title='Forks'>
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
            </ChipModalField>
          ) : (
            <>
              <ChipModalField
                type='dropdown'
                title='Action'
                value={selectedKey}
                onChange={setSelectedKey}
                options={edgeOptions}
                placeholder='Select action'
                align='start'
              />

              {diff.data?.drift ? (
                <div className='px-2 text-[var(--text-secondary)] text-xs'>
                  Target changed since the last sync — syncing will overwrite those changes.
                </div>
              ) : null}

              {workflowChanges.length > 0 ? (
                <ChipModalField type='custom' title='Deployed Workflows'>
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
                </ChipModalField>
              ) : null}

              {(diff.data?.mcpReauthServerIds.length ?? 0) > 0 ||
              (diff.data?.inlineSecretSources.length ?? 0) > 0 ? (
                <ChipModalField type='custom' title='Heads up'>
                  {(diff.data?.mcpReauthServerIds.length ?? 0) > 0 ? (
                    <div className='text-[var(--text-secondary)] text-xs'>
                      {diff.data?.mcpReauthServerIds.length} MCP server(s) use OAuth and must be
                      re-authorized in the target workspace.
                    </div>
                  ) : null}
                  {(diff.data?.inlineSecretSources.length ?? 0) > 0 ? (
                    <div className='mt-1 text-[var(--text-secondary)] text-xs'>
                      {diff.data?.inlineSecretSources.length} inline secret(s) can't be auto-mapped
                      — set them in the target workspace.
                    </div>
                  ) : null}
                </ChipModalField>
              ) : null}

              {groupedEntries.map((group) => (
                <div key={group.kind} className='flex flex-col px-2'>
                  <span className='text-[var(--text-muted)] text-xs'>{group.label}</span>
                  <div className='mt-[7px] mb-2.5 h-px bg-[var(--border)]' />
                  <div className='grid grid-cols-[minmax(0,1fr)_8px_minmax(0,1fr)] items-center gap-y-2'>
                    {group.items.map((entry) => (
                      <MappingRow
                        key={entryKey(entry)}
                        entry={entry}
                        value={targets[entryKey(entry)] ?? ''}
                        onChange={(value) =>
                          setTargets((prev) => ({ ...prev, [entryKey(entry)]: value }))
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={submitting}
          secondaryActions={
            showRollback
              ? [
                  {
                    custom: (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <span
                            className={
                              rollbackDisabled ? 'inline-flex cursor-not-allowed' : 'inline-flex'
                            }
                          >
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
                    ),
                  },
                ]
              : undefined
          }
          primaryAction={
            isManage
              ? { label: 'Done', onClick: () => onOpenChange(false) }
              : {
                  label: submitting ? 'Working...' : 'Sync',
                  onClick: () => void runPromote(false),
                  disabled:
                    submitting || !otherWorkspaceId || !requiredComplete || mapping.isLoading,
                  disabledTooltip: requiredComplete
                    ? undefined
                    : 'Map all required credentials and secrets first',
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
