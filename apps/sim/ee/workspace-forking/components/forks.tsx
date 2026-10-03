'use client'

import { useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { ArrowLeft, Plus, TriangleAlert } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import type { SettingsAction } from '@/components/settings/settings-header'
import type { ForkLineageChildApi, ForkLineageNodeApi } from '@/lib/api/contracts/workspace-fork'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components/resource/components/floating-overflow-text'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  forkIdParam,
  forkIdUrlKeys,
  forkViewParam,
  forkViewUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import {
  type RowAction,
  RowActionsMenu,
} from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { ForkActivityPanel } from '@/ee/workspace-forking/components/fork-activity-panel/fork-activity-panel'
import { ForkSyncDefaultToggle } from '@/ee/workspace-forking/components/fork-sync-default-toggle/fork-sync-default-toggle'
import { ForkSyncedWorkflows } from '@/ee/workspace-forking/components/fork-synced-workflows/fork-synced-workflows'
import { ForkWorkspaceModal } from '@/ee/workspace-forking/components/fork-workspace-modal/fork-workspace-modal'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import {
  useForkLineage,
  useRollbackFork,
  useUnlinkFork,
} from '@/ee/workspace-forking/hooks/workspace-fork'
import { useWorkspaceCreationPolicy, useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/**
 * The parent edge's sync page carries the mapping editors, which reach the block and trigger
 * registries. Loaded when opened, so the fork list does not download them; `loading` gives it
 * its own boundary, since the section page has none.
 */
const ForkSyncDetailView = dynamic(
  () =>
    import('@/ee/workspace-forking/components/fork-sync-detail-view/fork-sync-detail-view').then(
      (m) => m.ForkSyncDetailView
    ),
  { loading: () => null }
)

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
      <div className='flex shrink-0 items-center gap-1'>
        <RowActionsMenu label='Fork actions' actions={actions} />
      </div>
    </div>
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
  const { billingEnabled } = useDeploymentShape()
  const { available: forkingAvailable, isLoading: availabilityLoading } =
    useForkingAvailability(workspaceId)
  const canUseForking = forkingAvailable && canAdmin

  const { data: workspaces } = useWorkspacesQuery()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { navigateToSettings } = useSettingsNavigation()
  const lineage = useForkLineage(workspaceId, canUseForking)
  const rollback = useRollbackFork()
  const unlink = useUnlinkFork()

  const [searchTerm, setSearchTerm] = useSettingsSearch()
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
      const result = await rollback.mutateAsync({
        workspaceId,
        body: { otherWorkspaceId: undoableRun.otherWorkspaceId },
      })
      if (result.pendingActivations.length > 0) {
        toast.warning(`Undid sync from "${undoableRun.otherName}"`, {
          description: `${result.pendingActivations.length} restored deployment(s) are still activating. Undo stays available until they finish, in case a retry is needed.`,
        })
      } else {
        toast.success(`Undid sync from "${undoableRun.otherName}"`)
      }
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
          workspaceName={workspaceName}
          otherWorkspaceId={parent.id}
          otherWorkspaceName={parent.name}
          onBack={() => void setSelectedForkId(null, { history: 'replace' })}
          actions={parentHeaderActions}
        />
      ) : forkView === 'activity' ? (
        <ForkActivityDetailView
          workspaceId={workspaceId}
          workspaceNames={lineagePartnerNames(parent, forks)}
          onBack={() => void setForkView(null, { history: 'replace' })}
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
          ) : lineage.isLoading ? null : (
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
              <SettingsSection label='Synced workflows'>
                <div className='flex flex-col gap-4'>
                  {/* Only this workspace's own value: a placeholder from the previous workspace
                      would show, and on click write, another lineage's policy. */}
                  {lineage.data && !lineage.isPlaceholderData ? (
                    <ForkSyncDefaultToggle
                      workspaceId={workspaceId}
                      excludeNewWorkflows={lineage.data.forkSyncNewWorkflowsExcluded}
                    />
                  ) : null}
                  <ForkSyncedWorkflows workspaceId={workspaceId} />
                </div>
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
          if (billingEnabled) navigateToSettings({ section: 'billing' })
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
          <TriangleAlert className='mt-[1px] size-[14px] shrink-0' />
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
          <TriangleAlert className='mt-[1px] size-[14px] shrink-0' />
          <span>
            Resources copied into this workspace during syncs may remain afterward — rollback
            restores workflows to their prior versions but does not remove copied resources.
          </span>
        </div>
      </ChipConfirmModal>
    </>
  )
}
