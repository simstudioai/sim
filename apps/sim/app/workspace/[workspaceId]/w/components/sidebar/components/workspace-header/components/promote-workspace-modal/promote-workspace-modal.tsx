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
  ChipTag,
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
  parent: ForkLineageNodeApi | null
  childWorkspaces: ForkLineageNodeApi[]
  undoableRun: { otherWorkspaceId: string; otherName: string; direction: ForkDirection } | null
}

const entryKey = (entry: ForkMappingEntry) => `${entry.kind}:${entry.sourceId}`

const WORKFLOW_ACTION_LABEL: Record<ForkWorkflowChange['action'], string> = {
  update: 'Update',
  create: 'Create',
  archive: 'Archive',
}

interface EdgeOption {
  value: string
  label: string
  otherWorkspaceId: string
  direction: ForkDirection
}

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
    <ChipModalField type='custom' title={entry.sourceLabel}>
      <ChipCombobox
        options={entry.candidates.map((candidate) => ({
          label: candidate.label,
          value: candidate.id,
        }))}
        value={value || undefined}
        onChange={onChange}
        placeholder='Select target'
      />
    </ChipModalField>
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
  // No parent edge → this workspace is a fork root; the modal manages its forks.
  const isManage = parent == null

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

  const requiredEntries = entries.filter((entry) => entry.required)
  const optionalEntries = entries.filter((entry) => !entry.required)
  const requiredComplete = requiredEntries.every((entry) => (targets[entryKey(entry)] ?? '') !== '')

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
                title='Direction'
                value={selectedKey}
                onChange={setSelectedKey}
                options={edgeOptions}
                placeholder='Select direction'
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
                          className='flex items-center justify-between gap-2'
                        >
                          <div className='flex min-w-0 flex-1 items-center gap-1.5'>
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
                          {change.action !== 'update' ? (
                            <ChipTag variant='gray' className='shrink-0'>
                              {WORKFLOW_ACTION_LABEL[change.action]}
                            </ChipTag>
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

              {requiredEntries.length > 0 ? (
                <div className='px-2 font-medium text-[var(--text-secondary)] text-xs'>
                  Credentials & secrets
                </div>
              ) : null}
              {requiredEntries.map((entry) => (
                <MappingRow
                  key={entryKey(entry)}
                  entry={entry}
                  value={targets[entryKey(entry)] ?? ''}
                  onChange={(value) =>
                    setTargets((prev) => ({ ...prev, [entryKey(entry)]: value }))
                  }
                />
              ))}

              {optionalEntries.length > 0 ? (
                <div className='px-2 font-medium text-[var(--text-secondary)] text-xs'>
                  Additional resources (optional)
                </div>
              ) : null}
              {optionalEntries.map((entry) => (
                <MappingRow
                  key={entryKey(entry)}
                  entry={entry}
                  value={targets[entryKey(entry)] ?? ''}
                  onChange={(value) =>
                    setTargets((prev) => ({ ...prev, [entryKey(entry)]: value }))
                  }
                />
              ))}
            </>
          )}

          {undoableRun ? (
            <ChipModalField type='custom' title='Undo last sync'>
              <div className='flex items-center justify-between gap-3'>
                <div className='text-[var(--text-secondary)] text-xs'>
                  The last sync into this workspace (from {undoableRun.otherName}) can be undone —
                  it restores each workflow's prior deployed version.
                </div>
                <Chip
                  variant='destructive'
                  onClick={() => setConfirmRollbackOpen(true)}
                  disabled={submitting}
                >
                  Rollback
                </Chip>
              </div>
            </ChipModalField>
          ) : null}
        </ChipModalBody>
        {isManage ? null : (
          <ChipModalFooter
            onCancel={() => onOpenChange(false)}
            cancelDisabled={submitting}
            primaryAction={{
              label: submitting ? 'Working...' : 'Sync',
              onClick: () => void runPromote(false),
              disabled: submitting || !otherWorkspaceId || !requiredComplete || mapping.isLoading,
              disabledTooltip: requiredComplete
                ? undefined
                : 'Map all required credentials and secrets first',
            }}
          />
        )}
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
