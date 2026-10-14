'use client'

import { lazy, Suspense } from 'react'
import { Skeleton } from '@sim/emcn'
import { ArrowRight, Columns2 } from '@sim/emcn/icons'
import type { ForkWorkflowChange, ForkWorkflowComparison } from '@/lib/api/contracts/workspace-fork'
import { ForkSyncView } from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import type { ForkSyncController } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'

const ForkComparisonModal = lazy(() =>
  import('@/ee/workspace-forking/components/fork-sync/fork-comparison-modal').then((module) => ({
    default: module.ForkComparisonModal,
  }))
)

type ComparisonUnavailableReason = Extract<
  ForkWorkflowComparison,
  { status: 'unavailable' }
>['reason']

/** Why a workflow's changes can't be compared; a new workflow's badge already says so. */
const COMPARISON_UNAVAILABLE: Record<ComparisonUnavailableReason, string | null> = {
  new_workflow: null,
  no_baseline: 'Comparable after the first sync',
  missing_baseline: 'Last synced version unavailable',
}

const ACTION_LABEL: Record<ForkWorkflowChange['action'], string> = {
  update: 'Updated',
  create: 'New',
  archive: 'Archived',
}

interface SyncReviewProps {
  controller: ForkSyncController
  direction: ForkDirection
}

/**
 * What one sync between two environments ships, as a release: the deployed workflows it
 * changes, each opening the side-by-side comparison. The wizard footer owns Sync.
 */
export function SyncReview({ direction, controller }: SyncReviewProps) {
  const changes = controller.workflowChanges
  const changedCount = changes.length
  /** Workflows marked not synced on either side; the sync leaves them alone. */
  const skipped = [...controller.excludedSourceWorkflows, ...controller.excludedTargetWorkflows]

  return (
    <section className='flex flex-col gap-3'>
      <article className='overflow-hidden rounded-xl border border-[var(--border)]'>
        <header className='flex flex-wrap items-center justify-between gap-3 border-[var(--border)] border-b px-4 py-3 text-caption'>
          <span className='text-[var(--text-body)]'>
            {controller.isError
              ? 'Comparison unavailable'
              : controller.isLoading || !controller.hasDiff
                ? 'Comparing environments…'
                : changedCount === 0
                  ? 'Already in sync'
                  : `${changedCount} ${changedCount === 1 ? 'change' : 'changes'} to review`}
          </span>
          {!controller.isLoading &&
          !controller.isError &&
          controller.hasDiff &&
          changedCount > 0 ? (
            <span className='text-[var(--text-muted)]'>
              Syncing overwrites {controller.targetWorkspaceName}
            </span>
          ) : null}
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
        ) : changes.length + skipped.length === 0 ? (
          <p className='px-4 py-3 text-[var(--text-muted)] text-small'>
            No deployed workflows to sync.
          </p>
        ) : (
          <ul className='flex flex-col'>
            {changes.map((change, index) => {
              const comparable =
                change.action !== 'archive' &&
                change.comparison.status === 'available' &&
                controller.comparisonReady &&
                !controller.diffIsStale
                  ? change
                  : null
              const unavailable =
                change.action !== 'archive' &&
                controller.comparisonReady &&
                change.comparison.status === 'unavailable'
                  ? COMPARISON_UNAVAILABLE[change.comparison.reason]
                  : undefined
              const renamed = change.currentName !== change.otherName
              const row = (
                <>
                  <span className='shrink-0 rounded-md bg-[var(--surface-5)] px-1.5 py-0.5 text-[var(--text-secondary)] text-caption'>
                    {ACTION_LABEL[change.action]}
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
                  ) : unavailable ? (
                    <span className='ml-auto shrink-0 text-[var(--text-muted)] text-caption'>
                      {unavailable}
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
                      onClick={() => controller.openComparison(comparable)}
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
            {skipped.map((name, index) => (
              <li
                key={`skipped:${name}:${index}`}
                className='flex min-w-0 items-center gap-2 border-[var(--border)] border-b px-4 py-2.5 last:border-b-0'
              >
                <span className='min-w-0 truncate text-[var(--text-muted)] text-small'>{name}</span>
                <span className='ml-auto shrink-0 text-[var(--text-muted)] text-caption'>
                  Not synced
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <ForkSyncView
        key={direction}
        controller={controller}
        externalMappings
        externalWorkflows
        externalCopy
      />

      {controller.comparisonSelection ? (
        <Suspense fallback={null}>
          <ForkComparisonModal
            {...controller.comparisonSelection}
            onClose={controller.closeComparison}
          />
        </Suspense>
      ) : null}
    </section>
  )
}
