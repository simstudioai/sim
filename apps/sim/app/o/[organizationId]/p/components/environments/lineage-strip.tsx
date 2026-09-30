'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipLink,
  ChipTag,
  cn,
  OverflowText,
  Tooltip,
  toast,
} from '@sim/emcn'
import { ArrowRight, ArrowUpRight, Plus, RefreshCw, Server, TriangleAlert } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { getWorkspaceSettingsHref } from '@/components/settings/navigation'
import type { GetForkLineageResponse } from '@/lib/api/contracts/workspace-fork'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { workspaceRoutes } from '@/app/o/[organizationId]/p/routes'
import {
  forkIdParam,
  forkSyncDirectionParam,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { ForkWorkspaceModal } from '@/ee/workspace-forking/components/fork-workspace-modal/fork-workspace-modal'
import { useUnlinkFork } from '@/ee/workspace-forking/hooks/workspace-fork'
import { useWorkspaceCreationPolicy } from '@/hooks/queries/workspace'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/** Explains a disabled Sync whose parent workspace the viewer cannot open. */
const NO_ACCESS_TOOLTIP = "You don't have access to the parent workspace"

/** The fork's sync page for its parent edge, pulling the parent's changes in. */
function syncHref(column: EnvironmentColumn, parentId: string): string {
  return getWorkspaceSettingsHref(
    column.id,
    'forks',
    new URLSearchParams({ [forkIdParam.key]: parentId, [forkSyncDirectionParam.key]: 'pull' })
  )
}

interface UnlinkTarget {
  column: EnvironmentColumn
  parent: EnvironmentColumn
}

interface EnvironmentCardProps {
  column: EnvironmentColumn
  parent?: EnvironmentColumn
  current: boolean
  lineage?: GetForkLineageResponse
  canManage: boolean
  onDisconnect: () => void
}

function EnvironmentCard({
  column,
  parent,
  current,
  lineage,
  canManage,
  onDisconnect,
}: EnvironmentCardProps) {
  const parentAccessible = lineage?.parent?.viewerAccessible ?? true
  const undoable = lineage?.undoableRun ?? null
  const showSync = canManage && parent !== undefined
  return (
    <article className='flex w-[260px] shrink-0 flex-col gap-2 rounded-lg border border-[var(--border)] px-4 py-3'>
      <div className='flex items-center gap-2'>
        <Server className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='text-[var(--text-body)] text-small'>{column.label}</span>
        {current ? <ChipTag variant='gray'>Current</ChipTag> : null}
        {canManage && parent ? (
          <RowActionsMenu
            label={`${column.label} actions`}
            triggerClassName='ml-auto'
            actions={[
              // Disconnect stays enabled regardless of access: severing the edge acts on this
              // workspace only, and must remain reachable exactly when the parent is inaccessible.
              {
                label: `Disconnect from ${parent.label}`,
                destructive: true,
                onSelect: onDisconnect,
              },
            ]}
          />
        ) : null}
      </div>
      <OverflowText label={column.name} className='text-[var(--text-muted)] text-small' />
      <p className='text-[var(--text-muted)] text-caption'>
        {parent ? `Forked from ${parent.label}` : 'Root of the lineage'}
        {undoable ? ` · last sync from ${undoable.otherName} can be undone` : ''}
      </p>
      <div className='mt-auto flex flex-wrap items-center gap-1 pt-1'>
        <ChipLink href={workspaceRoutes.workflows(column.id)} leftIcon={ArrowUpRight}>
          Open workspace
        </ChipLink>
        {showSync && parent && parentAccessible ? (
          <ChipLink href={syncHref(column, parent.id)} leftIcon={RefreshCw}>
            Sync
          </ChipLink>
        ) : null}
        {showSync && !parentAccessible ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='inline-flex'>
                <Chip leftIcon={RefreshCw} disabled>
                  Sync
                </Chip>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content>{NO_ACCESS_TOOLTIP}</Tooltip.Content>
          </Tooltip.Root>
        ) : null}
      </div>
    </article>
  )
}

interface LineageStripProps {
  project: Project
  /** Root first, each fork after its parent. */
  columns: readonly EnvironmentColumn[]
  /** Each environment's lineage node, once loaded; empty until the fork gate passes. */
  lineageByEnv: ReadonlyMap<string, GetForkLineageResponse | undefined>
  /** Admin with forking available: Create fork, Sync and Disconnect are offered. */
  canManage: boolean
}

/**
 * One card per environment of the project, in lineage order. Create fork opens the real fork
 * modal on the current environment; a fork's card links to its parent edge's sync page and
 * can disconnect from its parent.
 */
export function LineageStrip({ project, columns, lineageByEnv, canManage }: LineageStripProps) {
  const { billingEnabled } = useDeploymentShape()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { navigateToSettings } = useSettingsNavigation()
  const unlink = useUnlinkFork()
  const [forkModalOpen, setForkModalOpen] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState<UnlinkTarget | null>(null)

  const byId = new Map(columns.map((column) => [column.id, column]))
  const current = byId.get(project.id)

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
    <section className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-[var(--text-body)] text-small'>Environments</h2>
        {canManage ? (
          <Chip variant='primary' leftIcon={Plus} onClick={() => setForkModalOpen(true)}>
            Create fork
          </Chip>
        ) : null}
      </div>
      <ol className='flex items-stretch gap-2 overflow-x-auto pb-1'>
        {columns.map((column, index) => {
          const parent = column.parentId ? byId.get(column.parentId) : undefined
          /** The arrow reads "forked from" only when the parent is the card before this one. */
          const chained = index > 0 && parent?.id === columns[index - 1].id
          return (
            <li key={column.id} className='flex items-stretch gap-2'>
              {index > 0 ? (
                <ArrowRight
                  className={cn(
                    'size-[14px] shrink-0 self-center text-[var(--text-icon)]',
                    !chained && 'invisible'
                  )}
                />
              ) : null}
              <EnvironmentCard
                column={column}
                parent={parent}
                current={column.id === project.id}
                lineage={lineageByEnv.get(column.id)}
                canManage={canManage}
                onDisconnect={() => {
                  if (parent) setConfirmUnlink({ column, parent })
                }}
              />
            </li>
          )
        })}
      </ol>

      <ForkWorkspaceModal
        open={forkModalOpen}
        onOpenChange={setForkModalOpen}
        sourceWorkspaceId={project.id}
        sourceWorkspaceName={current?.name || project.name}
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
