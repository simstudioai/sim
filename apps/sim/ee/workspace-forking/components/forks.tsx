'use client'

import { useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { AlertTriangle, Plus } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import type { ForkLineageChildApi, ForkLineageNodeApi } from '@/lib/api/contracts/workspace-fork'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  forkIdParam,
  forkIdUrlKeys,
  forkSyncDirectionParam,
  forkSyncDirectionUrlKeys,
  forkViewParam,
  forkViewUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import {
  type RowAction,
  RowActionsMenu,
} from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { saveDiscardActions } from '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { ForkActivityPanel } from '@/ee/workspace-forking/components/fork-activity-panel/fork-activity-panel'
import { ForkSyncView } from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import {
  ARCHIVED_PREVIEW_LIMIT,
  useForkSync,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { ForkWorkspaceModal } from '@/ee/workspace-forking/components/fork-workspace-modal/fork-workspace-modal'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import {
  useForkLineage,
  useRollbackFork,
  useUnlinkFork,
} from '@/ee/workspace-forking/hooks/workspace-fork'
import { useWorkspaceCreationPolicy, useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/** Explains a disabled lineage action whose target workspace the viewer cannot open. */
const NO_ACCESS_TOOLTIP = "You don't have access to this workspace"

/** Lineage partner names by id (the parent + this workspace's forks), for the Activity view. */
function lineagePartnerNames(
  parent: ForkLineageNodeApi | null,
  forks: ForkLineageChildApi[]
): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  if (parent) names.set(parent.id, parent.name)
  for (const fork of forks) names.set(fork.id, fork.name)
  return names
}

interface ForkListRowProps {
  name: string
  /** Entries for the row's `...` menu (Edit mappings / Open workspace / Disconnect). */
  actions: RowAction[]
}

function ForkListRow({ name, actions }: ForkListRowProps) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <FloatingOverflowText
        label={name}
        className='block min-w-0 truncate text-[var(--text-body)] text-sm'
      />
      <div className='flex flex-shrink-0 items-center gap-1'>
        <RowActionsMenu label='Fork actions' actions={actions} />
      </div>
    </div>
  )
}

interface ForkSyncDetailViewProps {
  title: string
  workspaceId: string
  /** The other side of the edge being synced (this workspace's parent). */
  otherWorkspaceId: string
  otherWorkspaceName: string
  onBack: () => void
  /** Header chips rendered left of Sync (e.g. Open workspace) — the caller owns those. */
  actions: SettingsAction[]
}

/**
 * The parent edge's sync page (reached from the parent row): direction, deployed-workflow
 * changes, per-kind mappings (each an expandable row whose status badge is the summary),
 * copy resources, and blocking references, all as page sections.
 * The header's Sync chip is gated until zero blockers + required mappings + reconfigure are
 * complete, and always confirms the overwrite first — that confirm is the flow's one modal.
 * While the mapping has unsaved edits the header swaps to Discard/Save and leaving is guarded;
 * Sync itself persists the effective mapping as part of the run.
 */
function ForkSyncDetailView({
  title,
  workspaceId,
  otherWorkspaceId,
  otherWorkspaceName,
  onBack,
  actions,
}: ForkSyncDetailViewProps) {
  // Sync direction is shareable view state: a copied link opens the same side of the sync.
  const [direction, setDirection] = useQueryState(forkSyncDirectionParam.key, {
    ...forkSyncDirectionParam.parser,
    ...forkSyncDirectionUrlKeys,
  })

  const controller = useForkSync({
    workspaceId,
    otherWorkspaceId,
    otherWorkspaceName,
    direction,
    enabled: true,
  })

  // Guard leaving the detail view (Back) while the mapping has unsaved edits, and feed
  // the shared settings dirty store so a sidebar section switch confirms too.
  const guard = useSettingsUnsavedGuard({ isDirty: controller.dirty })

  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false)

  // Sync is the edge's primary action, so it's the rightmost/black chip; the caller's
  // Open workspace chip sits left of it. Dirty mapping edits swap the whole cluster
  // for Discard/Save until they're saved or discarded.
  const panelActions: SettingsAction[] = controller.dirty
    ? saveDiscardActions({
        dirty: controller.dirty,
        saving: controller.saving,
        onSave: controller.save,
        onDiscard: controller.discard,
      })
    : [
        ...actions,
        {
          text: controller.submitting ? 'Working...' : 'Sync',
          variant: 'primary' as const,
          onSelect: () => setConfirmSyncOpen(true),
          disabled: controller.syncDisabled,
          tooltip: controller.syncDisabled
            ? controller.syncDisabledReason
            : `Push to or pull from ${otherWorkspaceName}`,
        },
      ]

  const targetWorkspaceName = direction === 'push' ? otherWorkspaceName : 'this workspace'

  return (
    <>
      <SettingsPanel
        back={{
          text: 'Workspace Forks',
          icon: ArrowLeft,
          onSelect: () =>
            guard.guardBack(() => {
              void setDirection(null)
              onBack()
            }),
        }}
        title={title}
        actions={panelActions}
      >
        <ForkSyncView
          controller={controller}
          onDirectionChange={(next) => void setDirection(next)}
        />
      </SettingsPanel>

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />

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
            void controller.sync()
          },
          pending: controller.submitting,
          pendingLabel: 'Syncing...',
        }}
      >
        {controller.archivedWorkflowNames.length > 0 ? (
          <div className='flex flex-col gap-1 px-2'>
            <p className='break-words text-[var(--text-primary)] text-sm'>
              Will be archived in <span className='font-medium'>{targetWorkspaceName}</span>{' '}
              (deleted in the source):
            </p>
            {controller.archivedWorkflowNames
              .slice(0, ARCHIVED_PREVIEW_LIMIT)
              .map((name, index) => (
                <div
                  key={`${name}:${index}`}
                  className='min-w-0 truncate text-[var(--text-muted)] text-small'
                >
                  {name}
                </div>
              ))}
            {controller.archivedWorkflowNames.length > ARCHIVED_PREVIEW_LIMIT ? (
              <div className='text-[var(--text-muted)] text-small'>
                and {controller.archivedWorkflowNames.length - ARCHIVED_PREVIEW_LIMIT} more
              </div>
            ) : null}
          </div>
        ) : null}
      </ChipConfirmModal>
    </>
  )
}

interface ForkActivityDetailViewProps {
  workspaceId: string
  /** Lineage partner names by id, for phrasing rows recorded on the other side of an edge. */
  workspaceNames: ReadonlyMap<string, string>
  onBack: () => void
  /** Header actions (e.g. the destructive Rollback chip while the last sync is undoable). */
  actions?: SettingsAction[]
}

/**
 * Workspace-scoped activity: every fork, sync, and rollback involving this workspace
 * (both sides of each edge), reached from the page header's "See activity" action.
 */
function ForkActivityDetailView({
  workspaceId,
  workspaceNames,
  onBack,
  actions,
}: ForkActivityDetailViewProps) {
  return (
    <SettingsPanel
      back={{ text: 'Workspace Forks', icon: ArrowLeft, onSelect: onBack }}
      title='Activity'
      actions={actions}
    >
      <ForkActivityPanel workspaceId={workspaceId} workspaceNames={workspaceNames} />
    </SettingsPanel>
  )
}

/**
 * Forks settings page. The workspace's single parent (if it's a fork) sits in its own
 * "Parent" section, above the "Forks" list of child forks. The parent row's `...` menu
 * has Edit mappings (the child owns its edge's re-picks), Open workspace, and
 * Disconnect; fork rows offer Open workspace and Disconnect only. Activity is
 * workspace-scoped and lives behind the header's "See activity" action (including
 * Rollback when the last sync into this workspace is undoable). Sync lives on the
 * parent's sync detail page.
 * Forking and sync rewrite workflow state and deployments en masse, so the page is
 * workspace-admin only and gated on the workspace's fork entitlement - every fork route
 * re-checks both; the server remains the boundary.
 */
export function Forks() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { canAdmin, isLoading: permissionsLoading } = useUserPermissionsContext()
  const { available: forkingAvailable, isLoading: availabilityLoading } =
    useForkingAvailability(workspaceId)
  const canUseForking = forkingAvailable && canAdmin

  const { data: workspaces } = useWorkspacesQuery()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { navigateToSettings } = useSettingsNavigation()
  const lineage = useForkLineage(workspaceId, canUseForking)
  const rollback = useRollbackFork()
  const unlink = useUnlinkFork()

  const [searchTerm, setSearchTerm] = useState('')
  const [isForkModalOpen, setIsForkModalOpen] = useState(false)
  const [confirmRollbackOpen, setConfirmRollbackOpen] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState<{ id: string; name: string } | null>(null)

  const [selectedForkId, setSelectedForkId] = useQueryState(forkIdParam.key, {
    ...forkIdParam.parser,
    ...forkIdUrlKeys,
  })
  const [forkView, setForkView] = useQueryState(forkViewParam.key, {
    ...forkViewParam.parser,
    ...forkViewUrlKeys,
  })

  const workspaceName = workspaces?.find((workspace) => workspace.id === workspaceId)?.name
  const canFork = creationPolicy?.canCreate ?? true
  const parent = lineage.data?.parent ?? null
  const forks = lineage.data?.children ?? []
  const undoableRun = lineage.data?.undoableRun ?? null
  const gateLoading = availabilityLoading || permissionsLoading

  // Rollback undoes the last sync INTO this workspace, restoring each affected
  // workflow to its prior deployed version.
  const runRollback = async () => {
    if (!undoableRun) return
    try {
      await rollback.mutateAsync({
        workspaceId,
        body: { otherWorkspaceId: undoableRun.otherWorkspaceId },
      })
      toast.success(`Undid sync from "${undoableRun.otherName}"`)
      setConfirmRollbackOpen(false)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Undo failed'))
    }
  }

  const openForkWorkspace = (forkId: string) => {
    router.push(`/workspace/${forkId}/w`)
  }

  const openForkMappings = (forkId: string) => {
    void setSelectedForkId(forkId)
  }

  /** Permanently dissolve the edge with the confirmed workspace; both workspaces remain. */
  const runUnlink = async () => {
    if (!confirmUnlink) return
    try {
      await unlink.mutateAsync({
        workspaceId,
        body: { otherWorkspaceId: confirmUnlink.id },
      })
      toast.success(`Disconnected "${confirmUnlink.name}"`)
      setConfirmUnlink(null)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Disconnect failed'))
    }
  }

  if (gateLoading) {
    return <SettingsPanel />
  }

  if (!canUseForking) {
    return (
      <SettingsPanel>
        <SettingsEmptyState>
          {canAdmin
            ? 'Forking is not available for this workspace.'
            : 'Only workspace admins can manage forks.'}
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  const searchLower = searchTerm.trim().toLowerCase()
  const parentVisible =
    parent !== null && (!searchLower || parent.name.toLowerCase().includes(searchLower))
  const filteredForks = forks.filter((fork) => fork.name.toLowerCase().includes(searchLower))
  const hasRows = parent !== null || forks.length > 0

  // The sync detail exists only for the PARENT edge: sync (and the mapping re-picks it
  // persists) belongs to the child workspace configuring how it maps its parent's
  // resources, so a parent browsing its forks gets no detail for them (a stale fork-id
  // deep link falls back to the list). Fork rows offer Open workspace / Disconnect only.
  const showParentDetail = Boolean(selectedForkId && parent && parent.id === selectedForkId)

  // Open workspace sits left of the detail view's primary Sync chip, which the sync
  // page owns (it carries the gating). Rollback lives on the Activity view only.
  const parentHeaderActions: SettingsAction[] = parent
    ? [
        {
          text: 'Open workspace',
          onSelect: () => openForkWorkspace(parent.id),
          disabled: !parent.viewerAccessible,
          tooltip: parent.viewerAccessible ? undefined : NO_ACCESS_TOOLTIP,
        },
      ]
    : []

  return (
    <>
      {showParentDetail && parent ? (
        <ForkSyncDetailView
          key={parent.id}
          title={parent.name}
          workspaceId={workspaceId}
          otherWorkspaceId={parent.id}
          otherWorkspaceName={parent.name}
          onBack={() => setSelectedForkId(null)}
          actions={parentHeaderActions}
        />
      ) : forkView === 'activity' ? (
        <ForkActivityDetailView
          workspaceId={workspaceId}
          workspaceNames={lineagePartnerNames(parent, forks)}
          onBack={() => setForkView(null)}
          actions={
            undoableRun
              ? [
                  {
                    text: 'Rollback',
                    variant: 'destructive',
                    onSelect: () => setConfirmRollbackOpen(true),
                    disabled: rollback.isPending,
                    tooltip: `The last sync into this workspace (from ${undoableRun.otherName}) can be undone — it restores each workflow's prior deployed version.`,
                  },
                ]
              : undefined
          }
        />
      ) : (
        <SettingsPanel
          search={{
            value: searchTerm,
            onChange: setSearchTerm,
            placeholder: 'Search forks...',
          }}
          actions={[
            { text: 'See activity', onSelect: () => void setForkView('activity') },
            {
              text: 'Create fork',
              icon: Plus,
              variant: 'primary',
              onSelect: () => setIsForkModalOpen(true),
            },
          ]}
        >
          {lineage.isError ? (
            <div className='flex h-full flex-col items-center justify-center gap-2'>
              <p className='text-[var(--text-error)] text-sm leading-tight'>
                {getErrorMessage(lineage.error, 'Failed to load forks')}
              </p>
            </div>
          ) : lineage.isLoading ? null : !hasRows ? (
            <SettingsEmptyState>Click "Create fork" above to get started</SettingsEmptyState>
          ) : (
            <div className='flex flex-col gap-7'>
              {parentVisible && parent !== null && (
                <SettingsSection label='Parent'>
                  <ForkListRow
                    name={parent.name}
                    actions={[
                      {
                        label: 'Edit mappings',
                        onSelect: () => openForkMappings(parent.id),
                        disabled: !parent.viewerAccessible,
                        tooltip: parent.viewerAccessible ? undefined : NO_ACCESS_TOOLTIP,
                      },
                      {
                        label: 'Open workspace',
                        onSelect: () => openForkWorkspace(parent.id),
                        disabled: !parent.viewerAccessible,
                        tooltip: parent.viewerAccessible ? undefined : NO_ACCESS_TOOLTIP,
                      },
                      // Disconnect stays enabled regardless of access: severing the edge is a
                      // current-workspace operation (admin on the acting side only), and must
                      // remain reachable exactly when the other side is inaccessible.
                      {
                        label: 'Disconnect',
                        destructive: true,
                        onSelect: () => setConfirmUnlink({ id: parent.id, name: parent.name }),
                      },
                    ]}
                  />
                </SettingsSection>
              )}
              <SettingsSection label='Forks'>
                {filteredForks.length > 0 ? (
                  <div className='flex flex-col gap-2'>
                    {filteredForks.map((fork) => (
                      <ForkListRow
                        key={fork.id}
                        name={fork.name}
                        actions={[
                          {
                            label: 'Open workspace',
                            onSelect: () => openForkWorkspace(fork.id),
                            disabled: !fork.viewerAccessible,
                            tooltip: fork.viewerAccessible ? undefined : NO_ACCESS_TOOLTIP,
                          },
                          {
                            label: 'Disconnect',
                            destructive: true,
                            onSelect: () => setConfirmUnlink({ id: fork.id, name: fork.name }),
                          },
                        ]}
                      />
                    ))}
                  </div>
                ) : (
                  <SettingsEmptyState variant='inline'>
                    {searchTerm.trim()
                      ? `No forks found matching "${searchTerm}"`
                      : 'No forks yet — click "Create fork" above to get started'}
                  </SettingsEmptyState>
                )}
              </SettingsSection>
            </div>
          )}
        </SettingsPanel>
      )}

      <ForkWorkspaceModal
        open={isForkModalOpen}
        onOpenChange={setIsForkModalOpen}
        sourceWorkspaceId={workspaceId}
        sourceWorkspaceName={workspaceName || 'Workspace'}
        canFork={canFork}
        onUpgrade={() => {
          if (isBillingEnabled) navigateToSettings({ section: 'billing' })
        }}
      />

      <ChipConfirmModal
        open={confirmUnlink !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnlink(null)
        }}
        srTitle='Disconnect fork'
        title='Disconnect fork'
        text={[
          'This permanently removes the fork relationship with ',
          { text: confirmUnlink?.name ?? '', bold: true },
          ". Both workspaces stay exactly as they are, but they will no longer appear in each other's fork lists, and syncing between them stops.",
        ]}
        confirm={{
          label: 'Disconnect',
          onClick: () => void runUnlink(),
          pending: unlink.isPending,
          pendingLabel: 'Disconnecting...',
        }}
      >
        <div className='flex items-start gap-1.5 px-2 text-[var(--text-secondary)] text-caption'>
          <AlertTriangle className='mt-[1px] size-[14px] shrink-0' />
          <span>
            This cannot be undone — the saved mappings and sync history for this pair are deleted,
            and forking again creates a brand-new workspace.
          </span>
        </div>
      </ChipConfirmModal>

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
