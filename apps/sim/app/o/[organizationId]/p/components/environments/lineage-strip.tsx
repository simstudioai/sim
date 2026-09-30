'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipLink, ChipTag, OverflowText, toast } from '@sim/emcn'
import { ArrowUpRight, Plus, Server, TriangleAlert } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { GetForkLineageResponse } from '@/lib/api/contracts/workspace-fork'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { PipelineConnector } from '@/app/o/[organizationId]/p/components/environments/pipeline-connector'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { workspaceRoutes } from '@/app/o/[organizationId]/p/routes'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { ForkWorkspaceModal } from '@/ee/workspace-forking/components/fork-workspace-modal/fork-workspace-modal'
import { type ForkDirection, useUnlinkFork } from '@/ee/workspace-forking/hooks/workspace-fork'
import { useWorkspaceCreationPolicy } from '@/hooks/queries/workspace'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

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
  const undoable = lineage?.undoableRun ?? null
  return (
    <article className='flex w-[250px] shrink-0 flex-col gap-2 rounded-lg border border-[var(--border)] px-4 py-3'>
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
  /** Admin with forking available: Create fork, sync and Disconnect are offered. */
  canManage: boolean
  /** The edge whose sync is shown below the pipeline, by its fork's id, and its direction. */
  focus: PipelineFocus | null
  /** Deployed workflows each edge's sync would change, by fork id and direction. */
  changeCounts: ReadonlyMap<string, Partial<Record<ForkDirection, number>>>
  onFocus: (focus: PipelineFocus) => void
}

/** One sync between a fork and its parent: which fork, and which way changes flow. */
export interface PipelineFocus {
  childId: string
  direction: ForkDirection
}

/**
 * The project's environments as a pipeline, flowing toward the root on the right (Sandbox,
 * Staging, Prod). Between a fork and its parent sits the connector that reviews a promotion
 * or a refresh along that edge. Create fork opens the real fork modal; a fork's card can
 * disconnect from its parent.
 */
export function LineageStrip({
  project,
  columns,
  lineageByEnv,
  canManage,
  focus,
  changeCounts,
  onFocus,
}: LineageStripProps) {
  const { billingEnabled } = useDeploymentShape()
  const { data: creationPolicy } = useWorkspaceCreationPolicy()
  const { navigateToSettings } = useSettingsNavigation()
  const unlink = useUnlinkFork()
  const [forkModalOpen, setForkModalOpen] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState<UnlinkTarget | null>(null)

  const byId = new Map(columns.map((column) => [column.id, column]))
  /** Root-first reversed, so changes flow left to right toward production. */
  const flow = [...columns].reverse()
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
      <ol className='flex items-stretch overflow-x-auto pb-1'>
        {flow.map((column, index) => {
          const parent = column.parentId ? byId.get(column.parentId) : undefined
          const next = flow[index + 1]
          /** A connector links this card to the next only when the next is its parent. */
          const edgeToNext = next !== undefined && parent?.id === next.id
          const direction = focus?.childId === column.id ? focus.direction : 'push'
          return (
            <li key={column.id} className='flex items-stretch'>
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
              {edgeToNext && parent ? (
                <PipelineConnector
                  child={column}
                  parent={parent}
                  direction={direction}
                  changeCount={changeCounts.get(column.id)?.[direction]}
                  focused={focus?.childId === column.id}
                  canManage={canManage}
                  onReview={() => onFocus({ childId: column.id, direction })}
                  onDirectionChange={(next) => onFocus({ childId: column.id, direction: next })}
                />
              ) : next ? (
                <div className='w-6 shrink-0' />
              ) : null}
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
