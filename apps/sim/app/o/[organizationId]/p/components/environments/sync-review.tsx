'use client'

import { lazy, Suspense, useState } from 'react'
import { Chip, ChipSwitch, Skeleton, Tooltip } from '@sim/emcn'
import { ArrowRight, Columns2 } from '@sim/emcn/icons'
import type { ForkWorkflowChange } from '@/lib/api/contracts/workspace-fork'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { ForkSyncConfirmModal } from '@/ee/workspace-forking/components/fork-sync/fork-sync-confirm-modal'
import { ForkSyncView } from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import type { ForkSyncController } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'

const ForkComparisonModal = lazy(() =>
  import('@/ee/workspace-forking/components/fork-sync/fork-comparison-modal').then((module) => ({
    default: module.ForkComparisonModal,
  }))
)

const ACTION_LABEL: Record<ForkWorkflowChange['action'], string> = {
  update: 'Updated',
  create: 'New',
  archive: 'Archived',
}

interface SyncReviewProps {
  mappingChangesPending?: boolean
  controller: ForkSyncController
  onResolveMapping: (kind: ForkSyncController['groups'][number]['kind'], sourceId?: string) => void
  child: EnvironmentColumn
  parent: EnvironmentColumn
  direction: ForkDirection
  onDirectionChange: (direction: ForkDirection) => void
}

/**
 * What one sync between two environments ships, as a release: the deployed workflows it
 * changes, each opening the side-by-side comparison, and Sync, which confirms the overwrite
 * with the same modal the workspace fork settings use.
 */
export function SyncReview({
  child,
  parent,
  direction,
  onDirectionChange,
  controller,
  mappingChangesPending = false,
  onResolveMapping,
}: SyncReviewProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const promote = direction === 'push'
  const source = promote ? child : parent
  const target = promote ? parent : child
  const changes = controller.workflowChanges
  const changedCount = changes.length
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <section className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-[var(--text-body)] text-small'>This sync</h2>
        <ChipSwitch
          value={direction}
          onChange={(next: ForkDirection) => {
            setConfirmOpen(false)
            onDirectionChange(next)
          }}
          aria-label='Sync direction'
          disabled={controller.submitting}
          options={[
            { value: 'push', label: 'Push' },
            { value: 'pull', label: 'Pull' },
          ]}
        />
      </div>
      <article className='overflow-hidden rounded-xl border border-[var(--border)]'>
        <header className='flex flex-wrap items-center gap-3 border-[var(--border)] border-b px-4 py-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <h3 className='flex flex-wrap items-center gap-1.5 text-[var(--text-body)] text-small'>
              {source.label}
              <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
              {target.label}
            </h3>
            <span className='text-[var(--text-muted)] text-caption'>
              {controller.isError
                ? 'Comparison unavailable'
                : controller.isLoading || !controller.hasDiff
                  ? 'Comparing environments…'
                  : changedCount === 0
                    ? 'Already in sync'
                    : `${changedCount} ${changedCount === 1 ? 'change' : 'changes'} to review`}
            </span>
          </div>
          <div className='flex flex-col items-end gap-1'>
            <div className='flex items-center gap-3'>
              <Chip
                active={settingsOpen}
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                Sync settings
              </Chip>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Chip
                      variant='primary'
                      onClick={() => setConfirmOpen(true)}
                      disabled={
                        mappingChangesPending || controller.syncDisabled || controller.isLoading
                      }
                    >
                      {controller.submitting ? 'Syncing…' : 'Sync'}
                    </Chip>
                  </span>
                </Tooltip.Trigger>
                {mappingChangesPending || controller.syncDisabledReason ? (
                  <Tooltip.Content side='top'>
                    {mappingChangesPending
                      ? 'Save or discard mapping changes first'
                      : controller.syncDisabledReason}
                  </Tooltip.Content>
                ) : null}
              </Tooltip.Root>
            </div>
            {!controller.isLoading &&
            !controller.isError &&
            controller.hasDiff &&
            changedCount > 0 ? (
              <span className='text-[var(--text-muted)] text-caption'>
                Syncing overwrites {controller.targetWorkspaceName}
              </span>
            ) : null}
          </div>
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
              const comparable =
                change.action !== 'archive' &&
                change.comparison.status === 'available' &&
                controller.comparisonReady &&
                !controller.diffIsStale
                  ? change
                  : null
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
          </ul>
        )}
      </article>

      {controller.kindSummaries
        .filter((summary) => summary.requiredPending || summary.reconfigPending)
        .map((summary) => {
          const group = controller.groups.find((candidate) => candidate.kind === summary.kind)
          return (
            <div key={summary.kind} className='flex items-center justify-between gap-2 text-small'>
              <span className='text-[var(--text-muted)]'>{group?.label} need configuration</span>
              <Chip
                onClick={() =>
                  onResolveMapping(
                    summary.kind,
                    group?.items.find((entry) => !controller.targetFor(entry))?.sourceId ??
                      group?.items[0]?.sourceId
                  )
                }
              >
                Resolve mapping
              </Chip>
            </div>
          )
        })}

      {settingsOpen && <ForkSyncView key={direction} controller={controller} externalMappings />}

      {/* With the settings open, the embedded sync view renders the comparison itself. */}
      {!settingsOpen && controller.comparisonSelection ? (
        <Suspense fallback={null}>
          <ForkComparisonModal
            {...controller.comparisonSelection}
            onClose={controller.closeComparison}
          />
        </Suspense>
      ) : null}
      <ForkSyncConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        controller={controller}
      />
    </section>
  )
}
