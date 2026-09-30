'use client'

import { useState } from 'react'
import { Chip, ChipLink, cn, Skeleton, Tooltip } from '@sim/emcn'
import { ArrowRight, Columns2 } from '@sim/emcn/icons'
import { getWorkspaceSettingsHref } from '@/components/settings/navigation'
import type { ForkWorkflowChange } from '@/lib/api/contracts/workspace-fork'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import {
  forkIdParam,
  forkSyncDirectionParam,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { ForkSyncConfirmModal } from '@/ee/workspace-forking/components/fork-sync/fork-sync-confirm-modal'
import { ForkWorkflowDiffModal } from '@/ee/workspace-forking/components/fork-sync/fork-workflow-diff-modal'
import { useForkSync } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'

/** A changed workflow the sync would copy, with the id the side-by-side view compares from. */
type ComparableChange = Extract<ForkWorkflowChange, { action: 'update' | 'create' }> & {
  sourceWorkflowId: string
}

const ACTION_LABEL: Record<ForkWorkflowChange['action'], string> = {
  update: 'Updated',
  create: 'New',
  archive: 'Archived',
}

interface SyncReviewProps {
  child: EnvironmentColumn
  parent: EnvironmentColumn
  direction: ForkDirection
}

/**
 * What one sync between two environments ships, as a release: the deployed workflows it
 * changes, each opening the side-by-side comparison, and Sync, which confirms the overwrite
 * with the same modal the workspace fork settings use.
 */
export function SyncReview({ child, parent, direction }: SyncReviewProps) {
  const controller = useForkSync({
    workspaceId: child.id,
    workspaceName: child.name,
    otherWorkspaceId: parent.id,
    otherWorkspaceName: parent.name,
    direction,
    enabled: true,
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [comparing, setComparing] = useState<ComparableChange | null>(null)
  const promote = direction === 'push'
  const source = promote ? child : parent
  const target = promote ? parent : child
  const changes = controller.workflowChanges
  const changedCount = changes.filter(
    (change) => change.action !== 'update' || change.hasChanges
  ).length
  const settingsHref = getWorkspaceSettingsHref(
    child.id,
    'forks',
    new URLSearchParams({ [forkIdParam.key]: parent.id, [forkSyncDirectionParam.key]: direction })
  )

  return (
    <section className='flex flex-col gap-3'>
      <div className='flex items-baseline gap-2'>
        <h2 className='text-[var(--text-body)] text-small'>This sync</h2>
        <span className='text-[var(--text-muted)] text-small'>
          {promote ? 'Promote' : 'Refresh'} {child.label} {promote ? 'to' : 'from'} {parent.label}
        </span>
      </div>
      <article className='overflow-hidden rounded-xl border border-[var(--border)]'>
        <header className='flex items-center gap-3 border-[var(--border)] border-b px-4 py-3'>
          <span className='flex items-center gap-1.5 rounded-md bg-[var(--surface-4)] px-2 py-0.5 text-[var(--text-body)] text-small'>
            {source.label}
            <ArrowRight className='size-[12px] text-[var(--text-icon)]' />
            {target.label}
          </span>
          <div className='flex min-w-0 flex-1 flex-col'>
            <span className='text-[var(--text-body)] text-small'>
              {controller.isLoading
                ? 'Comparing environments…'
                : changedCount === 0
                  ? `${target.label} already matches ${source.label}`
                  : `${changedCount} ${changedCount === 1 ? 'workflow changes' : 'workflows change'} in ${target.label}`}
            </span>
            <span className='text-[var(--text-muted)] text-caption'>
              Syncing overwrites {controller.targetWorkspaceName}
            </span>
          </div>
          <ChipLink href={settingsHref}>Sync settings</ChipLink>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='inline-flex'>
                <Chip
                  variant='primary'
                  onClick={() => setConfirmOpen(true)}
                  disabled={controller.syncDisabled || controller.isLoading}
                >
                  {controller.submitting ? 'Syncing…' : 'Sync'}
                </Chip>
              </span>
            </Tooltip.Trigger>
            {controller.syncDisabledReason ? (
              <Tooltip.Content side='top'>{controller.syncDisabledReason}</Tooltip.Content>
            ) : null}
          </Tooltip.Root>
        </header>
        {controller.isError ? (
          <p className='px-4 py-3 text-[var(--text-error)] text-small'>
            {controller.errorMessage ?? "Couldn't compare these environments."}
          </p>
        ) : controller.isLoading || !controller.hasDiff ? (
          <div className='flex flex-col gap-2 px-4 py-3'>
            <Skeleton className='h-[18px] w-[260px]' />
            <Skeleton className='h-[18px] w-[200px]' />
          </div>
        ) : changes.length === 0 ? (
          <p className='px-4 py-3 text-[var(--text-muted)] text-small'>
            No deployed workflows to sync.
          </p>
        ) : (
          <ul className='flex flex-col'>
            {changes.map((change, index) => {
              const comparable: ComparableChange | null =
                change.action !== 'archive' &&
                change.hasChanges &&
                change.sourceWorkflowId &&
                !controller.diffIsStale
                  ? { ...change, sourceWorkflowId: change.sourceWorkflowId }
                  : null
              const unchanged = change.action === 'update' && !change.hasChanges
              const renamed = change.currentName !== change.otherName
              const row = (
                <>
                  <span
                    className={cn(
                      'shrink-0 rounded-md px-1.5 py-0.5 text-caption',
                      unchanged
                        ? 'bg-[var(--surface-4)] text-[var(--text-muted)]'
                        : 'bg-[var(--surface-5)] text-[var(--text-secondary)]'
                    )}
                  >
                    {unchanged ? 'No changes' : ACTION_LABEL[change.action]}
                  </span>
                  <span className='min-w-0 truncate text-[var(--text-body)] text-small'>
                    {change.currentName}
                  </span>
                  {renamed ? (
                    <>
                      <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
                      <span className='min-w-0 truncate text-[var(--text-secondary)] text-small'>
                        {change.otherName}
                      </span>
                    </>
                  ) : null}
                  {comparable ? (
                    <span className='ml-auto flex shrink-0 items-center gap-1.5 text-[var(--text-muted)] text-caption'>
                      <Columns2 className='size-[14px]' />
                      View changes
                    </span>
                  ) : null}
                </>
              )
              return (
                <li
                  key={`${change.action}:${change.currentName}:${index}`}
                  className='border-[var(--border)] border-b last:border-b-0'
                >
                  {comparable ? (
                    <button
                      type='button'
                      onClick={() => setComparing(comparable)}
                      className='flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left transition-colors hover-hover:bg-[var(--surface-hover)]'
                    >
                      {row}
                    </button>
                  ) : (
                    <div className='flex min-w-0 items-center gap-2 px-4 py-2.5'>{row}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </article>

      {comparing ? (
        <ForkWorkflowDiffModal
          key={`${direction}:${comparing.sourceWorkflowId}`}
          open
          onOpenChange={(open) => {
            if (!open) setComparing(null)
          }}
          workspaceId={child.id}
          otherWorkspaceId={parent.id}
          direction={direction}
          sourceWorkflowId={comparing.sourceWorkflowId}
          workflowName={comparing.currentName}
        />
      ) : null}
      <ForkSyncConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        controller={controller}
      />
    </section>
  )
}
