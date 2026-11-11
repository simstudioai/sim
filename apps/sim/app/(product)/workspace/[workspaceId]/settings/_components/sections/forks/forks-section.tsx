'use client'

import { lazy, Suspense, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { workspaceEntry } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
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
  forkIdParam,
  forkViewParam,
  useDeploymentShape,
  useForkLineage,
  useRollbackFork,
  useSettingsSearch,
  useUnlinkFork,
  useWorkspaceCreationPolicy,
  useWorkspacesQuery,
} from '@/platform/lib/data/forks'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { usePlatformHref } from '@/platform/lib/platform-href'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

/** The sync page carries the mapping editors, which reach the block registry: loaded when opened. */
const ForkSyncDetail = lazy(() =>
  import(
    '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-sync-detail'
  ).then((module) => ({ default: module.ForkSyncDetail }))
)

/** Explains a disabled action on a workspace the viewer cannot open. */
const NO_ACCESS_REASON = "You don't have access to this workspace"

/** The `fork-view` value that opens the workspace's sync activity. */
const ACTIVITY_VIEW = 'activity'

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
  const hrefFor = usePlatformHref()
  const scope = useSurfaceScope()
  const { canMutate } = useWorkspaceSettingsSection(workspaceId, 'forks')
  const { billingEnabled } = useDeploymentShape()
  const { data: workspaces } = useWorkspacesQuery()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const lineage = useForkLineage(workspaceId, canMutate)
  const rollback = useRollbackFork()
  const unlink = useUnlinkFork()
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const forkDetail = useSettingsSubview({ idParam: forkIdParam.key })
  const activityView = useSettingsSubview({ idParam: forkViewParam.key })
  const selectedForkId = forkDetail.id
  const [forking, setForking] = useState(false)
  const [confirmingRollback, setConfirmingRollback] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState<{ id: string; name: string } | null>(null)

  const workspaceName = workspaces?.find((workspace) => workspace.id === workspaceId)?.name
  const parent = lineage.data?.parent ?? null
  const forks = lineage.data?.children ?? []
  const undoableRun = lineage.data?.undoableRun ?? null

  const openWorkspace = (id: string) =>
    requestSettingsLeave(() => router.push(hrefFor(workspaceEntry(id))))

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

  const createFork = canMutate ? (
    <Button size='compact' icon='I074' onClick={() => setForking(true)}>
      Create fork
    </Button>
  ) : undefined

  const view =
    showParentDetail && parent ? (
      <Suspense fallback={null}>
        <ForkSyncDetail
          key={parent.id}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          parent={parent}
          onBack={forkDetail.close}
          onOpenWorkspace={() => openWorkspace(parent.id)}
        />
      </Suspense>
    ) : activityView.id === ACTIVITY_VIEW ? (
      <ForkActivity
        workspaceId={workspaceId}
        workspaceNames={lineagePartnerNames(parent, forks)}
        onBack={activityView.close}
        undoable={undoableRun}
        rollingBack={rollback.isPending}
        onRollback={() => setConfirmingRollback(true)}
      />
    ) : (
      <SectionStack>
        <SettingsPageHeader />
        <SettingsRead query={lineage} failureMessage='Couldn’t load forks'>
          {() => (
            <>
              <SectionToolbar
                grow={
                  parent || forks.length > 0 ? (
                    <SearchField
                      label='Search forks'
                      placeholder='Search forks…'
                      value={searchTerm}
                      onValueChange={setSearchTerm}
                    />
                  ) : undefined
                }
              >
                <Button size='compact' onClick={() => activityView.open(ACTIVITY_VIEW)}>
                  See activity
                </Button>
              </SectionToolbar>
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
                          onSelect: () => forkDetail.open(parent.id),
                          disabled: !parent.viewerAccessible,
                          disabledReason: parent.viewerAccessible ? undefined : NO_ACCESS_REASON,
                        },
                        ...rowActions(parent),
                      ]}
                    />
                  </SettingsRow>
                </SettingsSection>
              )}
              <SettingsList
                title='Forks'
                empty={
                  filteredForks.length > 0
                    ? undefined
                    : query
                      ? { title: 'No matching forks' }
                      : {
                          title: 'No forks yet',
                          description: 'Copy this workspace to work on separately',
                          action: createFork,
                        }
                }
              >
                {filteredForks.map((fork) => (
                  <SettingsRow key={fork.id} label={fork.name}>
                    <ActionMenu
                      label={`${fork.name} actions`}
                      icon='I108'
                      align='end'
                      actions={rowActions(fork)}
                    />
                  </SettingsRow>
                ))}
                {createFork && (
                  <SettingsRow
                    label='New fork'
                    description='Copy this workspace to work on separately'
                  >
                    {createFork}
                  </SettingsRow>
                )}
              </SettingsList>
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
        </SettingsRead>
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
            if (billingEnabled) router.push(hrefFor(surfaceHref(scope, '/settings/billing/plans')))
          }}
          onClose={() => setForking(false)}
        />
      )}
      <ConfirmDialog
        target={confirmUnlink}
        onClose={() => setConfirmUnlink(null)}
        title='Disconnect fork'
        description={({ name }) =>
          `Both workspaces stay as they are, but ${name} leaves this workspace's fork lists and syncing between them stops.`
        }
        confirmLabel='Disconnect'
        pendingLabel='Disconnecting…'
        onConfirm={runUnlink}
      >
        <InlineNotice
          intent='warning'
          message='This action cannot be undone. The saved mappings and sync history for this pair are deleted, and forking again creates a new workspace'
        />
      </ConfirmDialog>
      <ConfirmDialog
        target={confirmingRollback}
        onClose={() => setConfirmingRollback(false)}
        title='Undo last sync'
        description='Each affected workflow returns to its prior deployed version, and workflows the sync created are removed.'
        confirmLabel='Undo sync'
        pendingLabel='Undoing…'
        onConfirm={runRollback}
      >
        <InlineNotice
          intent='warning'
          message='Resources copied into this workspace during syncs stay; only workflows are restored'
        />
      </ConfirmDialog>
    </>
  )
}
