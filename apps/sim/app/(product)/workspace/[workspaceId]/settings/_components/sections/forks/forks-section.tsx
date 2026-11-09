'use client'

import { lazy, Suspense, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from '@/lib/toast/sink'
import {
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { ForkActivity } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-activity'
import {
  ForkSyncDefaultRow,
  ForkSyncedWorkflows,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-synced-workflows'
import { ForkWorkspaceModal } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-workspace-modal'
import {
  type ForkLineageChildApi,
  type ForkLineageNodeApi,
  useDeploymentShape,
  useForkIdParam,
  useForkLineage,
  useForkViewParam,
  useRollbackFork,
  useSettingsSearch,
  useUnlinkFork,
  useWorkspaceCreationPolicy,
  useWorkspacesQuery,
} from '@/platform/lib/data/forks'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { platformHref } from '@/platform/lib/navigation'
import { workspaceEntry } from '@/platform/lib/workspace-navigation'

/** The sync page carries the mapping editors, which reach the block registry: loaded when opened. */
const ForkSyncDetail = lazy(() =>
  import(
    '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-sync-detail'
  ).then((module) => ({ default: module.ForkSyncDetail }))
)

/** Explains a disabled action on a workspace the viewer cannot open. */
const NO_ACCESS_REASON = "You don't have access to this workspace"

/** Lineage partner names by id (the parent and this workspace's forks), for Activity. */
function lineagePartnerNames(
  parent: ForkLineageNodeApi | null,
  forks: readonly ForkLineageChildApi[]
): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  if (parent) names.set(parent.id, parent.name)
  for (const fork of forks) names.set(fork.id, fork.name)
  return names
}

/**
 * The workspace's fork lineage: its parent, if it is a fork, above the forks made from it, then
 * which workflows sync. The parent's menu opens its sync page (the child owns how it maps its
 * parent's resources); every row opens the workspace or disconnects it. Activity, with Rollback
 * while the last sync into this workspace can be undone, is its own view. Forking and sync rewrite
 * workflows and deployments en masse, so the section is for workspace admins where forking is
 * available, and every fork route checks both again.
 */
export default function ForksSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const router = useRouter()
  const search = useSearchParams()
  const { canMutate } = useWorkspaceSettingsSection(workspaceId, 'forks')
  const { billingEnabled } = useDeploymentShape()
  const { data: workspaces } = useWorkspacesQuery()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const lineage = useForkLineage(workspaceId, canMutate)
  const rollback = useRollbackFork()
  const unlink = useUnlinkFork()
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedForkId, setSelectedForkId] = useForkIdParam()
  const [forkView, setForkView] = useForkViewParam()
  const [forking, setForking] = useState(false)
  const [confirmingRollback, setConfirmingRollback] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState<{ id: string; name: string } | null>(null)

  const workspaceName = workspaces?.find((workspace) => workspace.id === workspaceId)?.name
  const parent = lineage.data?.parent ?? null
  const forks = lineage.data?.children ?? []
  const undoableRun = lineage.data?.undoableRun ?? null

  const openWorkspace = (id: string) =>
    requestSettingsLeave(() => router.push(platformHref(workspaceEntry(id), search)))

  async function runRollback() {
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
    } catch (error) {
      toast.error(getErrorMessage(error, 'Undo failed'))
      return false
    }
  }

  /** Permanently dissolves the edge; both workspaces remain as they are. */
  async function runUnlink() {
    if (!confirmUnlink) return
    try {
      await unlink.mutateAsync({ workspaceId, body: { otherWorkspaceId: confirmUnlink.id } })
      toast.success(`Disconnected "${confirmUnlink.name}"`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Disconnect failed'))
      return false
    }
  }

  const rowActions = (node: { id: string; name: string; viewerAccessible: boolean }) => [
    {
      id: 'open',
      label: 'Open workspace',
      onSelect: () => openWorkspace(node.id),
      disabled: !node.viewerAccessible,
      disabledReason: node.viewerAccessible ? undefined : NO_ACCESS_REASON,
    },
    // Disconnecting acts on this workspace alone, so it stays available when the other is not.
    {
      id: 'disconnect',
      label: 'Disconnect',
      destructive: true,
      onSelect: () => setConfirmUnlink({ id: node.id, name: node.name }),
    },
  ]

  // Only the PARENT edge has a sync page: sync belongs to the child mapping its parent's resources.
  // A deep link waits for the lineage rather than flashing the list; a stale id falls back to it.
  if (selectedForkId !== null && lineage.isPending) return null
  const showParentDetail = Boolean(selectedForkId && parent && parent.id === selectedForkId)

  const query = searchTerm.trim().toLowerCase()
  const parentVisible = parent !== null && (!query || parent.name.toLowerCase().includes(query))
  const filteredForks = forks.filter((fork) => fork.name.toLowerCase().includes(query))

  const view =
    showParentDetail && parent ? (
      <Suspense fallback={null}>
        <ForkSyncDetail
          key={parent.id}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          parent={parent}
          onBack={() => void setSelectedForkId(null, { history: 'replace' })}
          onOpenWorkspace={() => openWorkspace(parent.id)}
        />
      </Suspense>
    ) : forkView === 'activity' ? (
      <ForkActivity
        workspaceId={workspaceId}
        workspaceNames={lineagePartnerNames(parent, forks)}
        onBack={() => void setForkView(null, { history: 'replace' })}
        undoable={undoableRun}
        rollingBack={rollback.isPending}
        onRollback={() => setConfirmingRollback(true)}
      />
    ) : (
      <SectionStack>
        <SectionToolbar
          grow={
            <SearchField
              label='Search forks'
              placeholder='Search forks...'
              value={searchTerm}
              onValueChange={setSearchTerm}
            />
          }
        >
          <Button variant='secondary' size='compact' onClick={() => void setForkView('activity')}>
            See activity
          </Button>
        </SectionToolbar>
        {lineage.isError ? (
          <FailureNotice
            message={getErrorMessage(lineage.error, 'Failed to load forks')}
            retrying={lineage.isFetching}
            onRetry={() => void lineage.refetch()}
          />
        ) : lineage.isPending ? null : (
          <>
            {parentVisible && parent && (
              <SettingsSection title='Parent'>
                <SettingsRow label={parent.name}>
                  <ActionMenu
                    label={`${parent.name} actions`}
                    icon='I108'
                    align='end'
                    actions={[
                      {
                        id: 'mappings',
                        label: 'Edit mappings',
                        onSelect: () => void setSelectedForkId(parent.id),
                        disabled: !parent.viewerAccessible,
                        disabledReason: parent.viewerAccessible ? undefined : NO_ACCESS_REASON,
                      },
                      ...rowActions(parent),
                    ]}
                  />
                </SettingsRow>
              </SettingsSection>
            )}
            <SettingsSection title='Forks'>
              {filteredForks.length > 0 ? (
                filteredForks.map((fork) => (
                  <SettingsRow key={fork.id} label={fork.name}>
                    <ActionMenu
                      label={`${fork.name} actions`}
                      icon='I108'
                      align='end'
                      actions={rowActions(fork)}
                    />
                  </SettingsRow>
                ))
              ) : (
                <EmptyState
                  title={query ? `No forks found matching "${searchTerm.trim()}"` : 'No forks yet'}
                  description={query ? undefined : 'Create a fork to get started.'}
                />
              )}
              <SettingsRow label='New fork'>
                <Button
                  variant='primary'
                  size='compact'
                  icon='I074'
                  disabled={!canMutate}
                  onClick={() => setForking(true)}
                >
                  Create fork
                </Button>
              </SettingsRow>
            </SettingsSection>
            <SettingsSection title='Synced workflows'>
              {/* Only this workspace's own value: a previous workspace's placeholder would write another lineage's policy. */}
              {lineage.data && !lineage.isPlaceholderData && (
                <ForkSyncDefaultRow
                  workspaceId={workspaceId}
                  excludeNewWorkflows={lineage.data.forkSyncNewWorkflowsExcluded}
                />
              )}
              <ForkSyncedWorkflows workspaceId={workspaceId} />
            </SettingsSection>
          </>
        )}
      </SectionStack>
    )

  return (
    <>
      {view}
      {forking && (
        <ForkWorkspaceModal
          sourceWorkspaceId={workspaceId}
          sourceWorkspaceName={workspaceName || 'Workspace'}
          canFork={creationPolicy?.canCreate ?? true}
          onUpgrade={() => {
            if (billingEnabled) router.push(platformHref('/settings/billing/plans', search))
          }}
          onClose={() => setForking(false)}
        />
      )}
      <Modal
        variant='confirm'
        destructive
        open={confirmUnlink !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnlink(null)
        }}
        title='Disconnect fork'
        description={`This permanently removes the fork relationship with ${confirmUnlink?.name ?? ''}. Both workspaces stay exactly as they are, but they will no longer appear in each other's fork lists, and syncing between them stops.`}
        confirmLabel='Disconnect'
        onConfirm={runUnlink}
      >
        <InlineNotice
          intent='warning'
          message='This cannot be undone — the saved mappings and sync history for this pair are deleted, and forking again creates a brand-new workspace.'
        />
      </Modal>
      <Modal
        variant='confirm'
        destructive
        open={confirmingRollback}
        onOpenChange={setConfirmingRollback}
        title='Undo last sync'
        description='This restores each affected workflow to its prior deployed version and removes workflows the sync created. Continue?'
        confirmLabel='Rollback'
        onConfirm={runRollback}
      >
        <InlineNotice
          intent='warning'
          message='Resources copied into this workspace during syncs may remain afterward — rollback restores workflows to their prior versions but does not remove copied resources.'
        />
      </Modal>
    </>
  )
}
