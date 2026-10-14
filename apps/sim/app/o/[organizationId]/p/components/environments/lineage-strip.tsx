'use client'

import { type ReactNode, useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { TriangleAlert } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { parseAsString, useQueryStates } from 'nuqs'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { EnvironmentDetails } from '@/app/o/[organizationId]/p/components/environments/environment-details'
import { EnvironmentGraph } from '@/app/o/[organizationId]/p/components/environments/environment-graph'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { ForkWorkspaceModal } from '@/ee/workspace-forking/components/fork-workspace-modal/fork-workspace-modal'
import { type ForkDirection, useUnlinkFork } from '@/ee/workspace-forking/hooks/workspace-fork'
import { useWorkspaceCreationPolicy, useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

interface UnlinkTarget {
  column: EnvironmentColumn
  parent: EnvironmentColumn
}

interface LineageStripProps {
  project: Project
  /** Root first, each fork after its parent. */
  columns: readonly EnvironmentColumn[]
  /** Forking is available and the viewer administers an environment to fork from. */
  canCreateFork: boolean
  /** Forks whose edge to their parent the viewer can sync and disconnect. */
  manageableIds: ReadonlySet<string>
  /** Opens the sync of a fork with its parent in one direction. */
  onSync: (childId: string, direction: ForkDirection) => void
  /** Status shown over the canvas. */
  notice?: ReactNode
}

/**
 * The project's environments on a canvas, each block wired into the environment it was forked
 * from. A block's action bar pulls, pushes, or forks; clicking it zooms in and raises a sheet with
 * its details and the rest of its actions.
 */
export function LineageStrip({
  project,
  columns,
  canCreateFork,
  manageableIds,
  onSync,
  notice,
}: LineageStripProps) {
  const { billingEnabled } = useDeploymentShape()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { data: workspaces } = useWorkspacesQuery()
  const { navigateToSettings } = useSettingsNavigation()
  const [, setDestination] = useQueryStates(
    {
      project: parseAsString,
      pane: parseAsString,
      section: parseAsString,
      setting: parseAsString,
      search: parseAsString,
    },
    { history: 'push' }
  )
  const unlink = useUnlinkFork()
  const [forkSourceId, setForkSourceId] = useState<string | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState<UnlinkTarget | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)

  const byId = new Map(columns.map((column) => [column.id, column]))
  const renameableIds = new Set(
    workspaces
      ?.filter((workspace) => workspace.permissions === 'admin')
      .map((workspace) => workspace.id)
  )

  const selected = selectedId ? byId.get(selectedId) : undefined
  const parent = selected?.parentId ? byId.get(selected.parentId) : undefined
  const forkCount = selected
    ? columns.filter((column) => column.parentId === selected.id).length
    : 0
  const isAdmin = Boolean(selected && renameableIds.has(selected.id))
  const canSync = Boolean(selected && parent && manageableIds.has(selected.id))

  /** Permanently dissolves the confirmed edge; both workspaces remain. */
  const runUnlink = async () => {
    if (!confirmUnlink) return
    try {
      await unlink.mutateAsync({
        workspaceId: confirmUnlink.column.id,
        body: { otherWorkspaceId: confirmUnlink.parent.id },
      })
      toast.success(`Disconnected ${confirmUnlink.column.label} from ${confirmUnlink.parent.label}`)
      setConfirmUnlink(null)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Disconnect failed'))
    }
  }

  return (
    <section aria-label='Environments' className='h-full min-h-0'>
      <EnvironmentGraph
        columns={columns}
        selectedId={selected?.id ?? null}
        onSelect={(id) => {
          setRenaming(false)
          setSelectedId(id)
        }}
        syncableIds={manageableIds}
        onSync={onSync}
        forkableIds={canCreateFork ? renameableIds : new Set()}
        onFork={setForkSourceId}
        notice={notice}
        sheet={
          selected ? (
            <EnvironmentDetails
              environment={selected}
              parent={parent}
              forkCount={forkCount}
              onSync={canSync ? (direction) => onSync(selected.id, direction) : undefined}
              pullInto={
                parent
                  ? undefined
                  : columns
                      .filter(
                        (column) => column.parentId === selected.id && manageableIds.has(column.id)
                      )
                      .map((fork) => ({
                        id: fork.id,
                        label: fork.label,
                        onSelect: () => onSync(fork.id, 'pull'),
                      }))
              }
              renaming={renaming}
              onRenamingChange={setRenaming}
              onOpenChangelog={() =>
                void setDestination({
                  project: selected.id,
                  pane: 'project',
                  section: 'changelog',
                  setting: null,
                  search: null,
                })
              }
              actions={[
                ...(canCreateFork && isAdmin
                  ? [{ label: 'Fork', onSelect: () => setForkSourceId(selected.id) }]
                  : []),
                ...(isAdmin
                  ? [
                      { label: 'Rename', focusesEditor: true, onSelect: () => setRenaming(true) },
                      {
                        label: 'Manage teammates',
                        onSelect: () =>
                          void setDestination({
                            project: selected.id,
                            pane: 'project',
                            section: 'settings',
                            setting: 'teammates',
                            search: null,
                          }),
                      },
                    ]
                  : []),
                ...(canSync && parent
                  ? [
                      {
                        label: `Disconnect from ${parent.label}`,
                        destructive: true,
                        onSelect: () => setConfirmUnlink({ column: selected, parent }),
                      },
                    ]
                  : []),
              ]}
            />
          ) : null
        }
      />

      <ForkWorkspaceModal
        open={forkSourceId !== null}
        onOpenChange={(open) => {
          if (!open) setForkSourceId(null)
        }}
        sourceWorkspaceId={forkSourceId ?? project.rootId}
        sourceWorkspaceName={byId.get(forkSourceId ?? project.rootId)?.name ?? project.name}
        sources={columns.map((column) => ({ id: column.id, name: column.name }))}
        canFork={creationPolicy?.canCreate ?? true}
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
          'This permanently removes the fork relationship between ',
          { text: confirmUnlink?.column.label ?? '', bold: true },
          ' and ',
          { text: confirmUnlink?.parent.label ?? '', bold: true },
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
            This cannot be undone: the saved mappings and sync history for this pair are deleted,
            and forking again creates a brand-new workspace.
          </span>
        </div>
      </ChipConfirmModal>
    </section>
  )
}
