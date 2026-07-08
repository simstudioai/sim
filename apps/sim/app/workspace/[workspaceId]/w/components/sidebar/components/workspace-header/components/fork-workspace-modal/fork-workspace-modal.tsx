'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipCopyInput,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  type ChipModalFooterSlotAction,
  ChipModalHeader,
  ChipModalTabs,
  Tooltip,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { GetForkResourcesResponse } from '@/lib/api/contracts/workspace-fork'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { ForkActivityPanel } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/fork-activity-panel/fork-activity-panel'
import {
  FileKindRow,
  ResourceKindRow,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/fork-resource-picker/fork-resource-picker'
import {
  type ForkDirection,
  useForkResources,
  useForkWorkspace,
  useRollbackFork,
} from '@/hooks/queries/workspace-fork'

interface ForkWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceWorkspaceId: string
  sourceWorkspaceName: string
  /** The last sync into this workspace that can be undone (drives the rollback action). */
  undoableRun: { otherWorkspaceId: string; otherName: string; direction: ForkDirection } | null
  /** Whether the user is under their workspace cap; creating a fork is gated on this. */
  canFork: boolean
  /** Sends the user to upgrade (billing) when they try to fork at the cap. */
  onUpgrade: () => void
}

type ResourceKey = Exclude<keyof GetForkResourcesResponse, 'deployedWorkflowCount'>
type ResourceSelection = Record<ResourceKey, Set<string>>

const RESOURCE_KINDS: ReadonlyArray<{ key: ResourceKey; label: string }> = [
  { key: 'files', label: 'Files' },
  { key: 'tables', label: 'Tables' },
  { key: 'knowledgeBases', label: 'Knowledge bases' },
  { key: 'customTools', label: 'Custom tools' },
  { key: 'skills', label: 'Skills' },
  { key: 'workflowMcpServers', label: 'Workflow MCP servers' },
]

const emptySelection = (): ResourceSelection => ({
  files: new Set(),
  tables: new Set(),
  knowledgeBases: new Set(),
  customTools: new Set(),
  skills: new Set(),
  workflowMcpServers: new Set(),
})

const fullSelection = (data: GetForkResourcesResponse): ResourceSelection => {
  const selection = emptySelection()
  for (const kind of RESOURCE_KINDS) {
    selection[kind.key] = new Set((data[kind.key] ?? []).map((item) => item.id))
  }
  return selection
}

/**
 * Names and creates a fork of the current workspace, lets the user pick which
 * resources to copy (whole kinds or a specific subset), then navigates into the new
 * fork. Unselected resources leave the corresponding workflow subblocks empty.
 */
export function ForkWorkspaceModal({
  open,
  onOpenChange,
  sourceWorkspaceId,
  sourceWorkspaceName,
  undoableRun,
  canFork,
  onUpgrade,
}: ForkWorkspaceModalProps) {
  const router = useRouter()
  const forkWorkspace = useForkWorkspace()
  const rollback = useRollbackFork()
  const resources = useForkResources(sourceWorkspaceId, open)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<ResourceSelection>(emptySelection)
  const [defaulted, setDefaulted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'config' | 'activity'>('config')
  const [forkedWorkspace, setForkedWorkspace] = useState<{ id: string; name: string } | null>(null)
  const [confirmRollbackOpen, setConfirmRollbackOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setName(`${sourceWorkspaceName} (fork)`)
      setSelected(emptySelection())
      setDefaulted(false)
      setError(null)
      setActiveTab('config')
      setForkedWorkspace(null)
      setConfirmRollbackOpen(false)
    }
  }, [open, sourceWorkspaceName])

  useEffect(() => {
    if (!open || !resources.data || defaulted) return
    setDefaulted(true)
    setSelected(fullSelection(resources.data))
  }, [open, resources.data, defaulted])

  const isForking = forkWorkspace.isPending

  const availableKinds = useMemo(
    () => RESOURCE_KINDS.filter((kind) => (resources.data?.[kind.key].length ?? 0) > 0),
    [resources.data]
  )

  const hasDeselection = useMemo(
    () =>
      defaulted &&
      availableKinds.some(
        (kind) => selected[kind.key].size < (resources.data?.[kind.key]?.length ?? 0)
      ),
    [defaulted, availableKinds, selected, resources.data]
  )

  // A fork always produces a usable workspace: deployed workflows are copied, and
  // when the source has none, create-fork seeds a blank starter workflow (plus any
  // selected resources). So forking is never blocked - we just set expectations when
  // there are no deployed workflows to carry over.
  const noDeployedWorkflows =
    Boolean(resources.data) && (resources.data?.deployedWorkflowCount ?? 0) === 0

  const handleSubmit = () => {
    // At a workspace cap, creating a fork is the only gated action - send the user to
    // upgrade rather than blocking the whole modal (rollback / Activity stay reachable).
    if (!canFork) {
      onUpgrade()
      return
    }
    const trimmed = name.trim()
    // Block until the resources query resolves: building `copy` from an unloaded `resources.data`
    // would send an empty selection and silently clear every reference in the fork. The Fork
    // action is disabled in this state too; this is the defense-in-depth guard.
    if (!trimmed || isForking || !resources.data) return
    setError(null)
    const copy = Object.fromEntries(
      RESOURCE_KINDS.map((kind) => [kind.key, Array.from(selected[kind.key])])
    )
    forkWorkspace.mutate(
      { workspaceId: sourceWorkspaceId, body: { name: trimmed, copy } },
      {
        onSuccess: (result) => {
          toast.success(`Forked into "${result.workspace.name}"`)
          setForkedWorkspace({ id: result.workspace.id, name: result.workspace.name })
          setActiveTab('activity')
        },
        onError: (err) => setError(err.message || 'Failed to fork workspace'),
      }
    )
  }

  const openFork = () => {
    if (!forkedWorkspace) return
    onOpenChange(false)
    router.push(`/workspace/${forkedWorkspace.id}/w`)
  }

  // Rollback undoes the last sync INTO this workspace, restoring each affected workflow
  // to its prior deployed version. Lives in the Activity tab's footer.
  const runRollback = async () => {
    if (!undoableRun) return
    try {
      await rollback.mutateAsync({
        workspaceId: sourceWorkspaceId,
        body: { otherWorkspaceId: undoableRun.otherWorkspaceId },
      })
      toast.success(`Undid sync from "${undoableRun.otherName}"`)
      setConfirmRollbackOpen(false)
      setActiveTab('activity')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Undo failed'))
    }
  }

  const rollbackDisabled = rollback.isPending || !undoableRun
  const rollbackTooltip = undoableRun
    ? `The last sync into this workspace (from ${undoableRun.otherName}) can be undone — it restores each workflow's prior deployed version.`
    : 'No sync to roll back yet.'
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
  const rollbackAction: ChipModalFooterSlotAction[] =
    activeTab === 'activity' && undoableRun ? [{ custom: rollbackChip }] : []

  return (
    <>
      <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Manage Forks'>
        <ChipModalHeader onClose={() => onOpenChange(false)}>Manage Forks</ChipModalHeader>
        <ChipModalBody>
          <ChipModalTabs
            tabs={[
              { value: 'config', label: 'Fork' },
              { value: 'activity', label: 'Activity' },
            ]}
            value={activeTab}
            onChange={(value) => setActiveTab(value as 'config' | 'activity')}
            className='mx-2'
          />
          {activeTab === 'activity' ? (
            <ForkActivityPanel
              pending={isForking || rollback.isPending}
              pendingLabel={rollback.isPending ? 'Undoing last sync…' : 'Creating fork…'}
              backgroundWorkspaceId={sourceWorkspaceId}
            />
          ) : (
            <>
              <div className='flex flex-col gap-7 px-2'>
                <SettingsSection label='Forking from'>
                  <ChipCopyInput value={sourceWorkspaceName} aria-label='Forking from' />
                </SettingsSection>

                <SettingsSection
                  label='Name'
                  headerAccessory={
                    <span className='text-[var(--text-error)]' title='Required'>
                      *
                    </span>
                  }
                >
                  <ChipInput
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        handleSubmit()
                      }
                    }}
                    placeholder='Workspace name'
                    maxLength={100}
                    autoComplete='off'
                    disabled={isForking}
                    aria-label='Workspace name'
                  />
                </SettingsSection>

                {availableKinds.length > 0 ? (
                  <SettingsSection label='Copy resources'>
                    <div className='flex flex-col gap-2'>
                      {availableKinds.map((kind) =>
                        kind.key === 'files' ? (
                          <FileKindRow
                            key={kind.key}
                            label={kind.label}
                            files={resources.data?.files ?? []}
                            selected={selected.files}
                            onToggleAll={(selectAll) =>
                              setSelected((prev) => ({
                                ...prev,
                                files: selectAll
                                  ? new Set((resources.data?.files ?? []).map((item) => item.id))
                                  : new Set<string>(),
                              }))
                            }
                            onToggleItem={(id, checked) =>
                              setSelected((prev) => {
                                const next = new Set(prev.files)
                                if (checked) next.add(id)
                                else next.delete(id)
                                return { ...prev, files: next }
                              })
                            }
                            onToggleMany={(ids, checked) =>
                              setSelected((prev) => {
                                const next = new Set(prev.files)
                                for (const id of ids) {
                                  if (checked) next.add(id)
                                  else next.delete(id)
                                }
                                return { ...prev, files: next }
                              })
                            }
                            disabled={isForking}
                          />
                        ) : (
                          <ResourceKindRow
                            key={kind.key}
                            label={kind.label}
                            items={resources.data?.[kind.key] ?? []}
                            selected={selected[kind.key]}
                            onToggleMany={(ids, checked) =>
                              setSelected((prev) => {
                                const next = new Set(prev[kind.key])
                                for (const id of ids) {
                                  if (checked) next.add(id)
                                  else next.delete(id)
                                }
                                return { ...prev, [kind.key]: next }
                              })
                            }
                            onToggleItem={(id, checked) =>
                              setSelected((prev) => {
                                const next = new Set(prev[kind.key])
                                if (checked) next.add(id)
                                else next.delete(id)
                                return { ...prev, [kind.key]: next }
                              })
                            }
                            disabled={isForking}
                          />
                        )
                      )}
                      {hasDeselection ? (
                        <div className='flex items-start gap-1.5 text-[var(--text-secondary)] text-caption'>
                          <AlertTriangle className='mt-[1px] size-[14px] shrink-0' />
                          <span>
                            Some resources are not selected — references to them in your workflows
                            will be cleared in the fork.
                          </span>
                        </div>
                      ) : (
                        <p className='text-[var(--text-muted)] text-caption'>
                          Everything referenced by your workflows is copied. Deselect a resource to
                          skip it — its references will be cleared.
                        </p>
                      )}
                    </div>
                  </SettingsSection>
                ) : null}

                {noDeployedWorkflows ? (
                  <p className='text-[var(--text-muted)] text-caption'>
                    No deployed workflows to copy — your fork will start with a blank workflow.
                  </p>
                ) : null}
              </div>
              <ChipModalError>{error ?? undefined}</ChipModalError>
            </>
          )}
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={isForking}
          secondaryActions={rollbackAction.length > 0 ? rollbackAction : undefined}
          primaryAction={
            activeTab === 'activity'
              ? forkedWorkspace
                ? { label: 'Open fork', onClick: openFork }
                : { label: 'Done', onClick: () => onOpenChange(false) }
              : {
                  label: isForking ? 'Forking...' : 'Fork',
                  onClick: handleSubmit,
                  // At the cap the button stays clickable (no name needed) so it can route to
                  // upgrade. Otherwise it needs a name AND the resources query loaded - forking
                  // before `resources.data` arrives would clear every reference (P1-C).
                  disabled: isForking || (canFork && (!name.trim() || !resources.data)),
                  disabledTooltip:
                    canFork && name.trim() && !resources.data
                      ? 'Loading workspace resources…'
                      : undefined,
                }
          }
        />
      </ChipModal>

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
          pending: rollback.isPending,
          pendingLabel: 'Rolling back...',
        }}
      >
        <div className='flex items-start gap-1.5 px-2 text-[var(--text-secondary)] text-caption'>
          <AlertTriangle className='mt-[1px] size-[14px] shrink-0' />
          <span>
            Resources copied into this workspace during syncs may remain afterward — rollback
            restores workflows to their prior versions but does not remove copied resources.
          </span>
        </div>
      </ChipConfirmModal>
    </>
  )
}
