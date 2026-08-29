'use client'

import { useMemo } from 'react'
import { cn, Tooltip } from '@sim/emcn'
import {
  formatMs,
  formatRunTime,
  formatUsd,
  getRunBuckets,
  getRunsSummary,
  type PrototypeRun,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/prototype-data'
import {
  getStatusLabel,
  RunStat,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/run-status'

/**
 * Run health across a range: success rate, median, failures, spend, and a strip
 * of every run in the window.
 *
 * NOT MOUNTED. Staged for the workspace-level Logs page, where a cross-run
 * summary belongs. The editor panel deliberately shows only the run list — a
 * panel beside the canvas is for reaching one run, and a dashboard above the
 * list was answering a question nobody asks there.
 *
 * Kept in the tree so it stays compiling and typechecked. It takes the runs it
 * should describe and reads nothing else, so pointing it at the real runs query
 * is the whole of the port.
 */

/** Columns the strip can show before runs have to be grouped into slices. */
const MAX_CHART_COLUMNS = 28

interface RunHealthProps {
  runs: PrototypeRun[]
  onSelectRun: (run: PrototypeRun) => void
}

export function RunHealth({ runs, onSelectRun }: RunHealthProps) {
  const summary = useMemo(() => getRunsSummary(runs), [runs])
  const buckets = useMemo(() => getRunBuckets(runs, MAX_CHART_COLUMNS), [runs])
  const busiestBucket = useMemo(
    () => buckets.reduce((most, bucket) => Math.max(most, bucket.runs.length), 1),
    [buckets]
  )

  const stats = [
    { label: 'Success rate', value: `${summary.successRate}%` },
    { label: 'Median run', value: formatMs(summary.medianMs) },
    { label: 'Failed', value: `${summary.failedCount} of ${summary.finishedCount}` },
    { label: 'Cost', value: formatUsd(summary.totalCostUsd) },
  ]

  return (
    <div className='px-3 py-3'>
      <div className='grid grid-cols-2 gap-1.5'>
        {stats.map((stat) => (
          <RunStat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      {/*
       * One column per run while they fit, equal slices of the range once they
       * do not — so the strip reads the same whether the workflow has run
       * seven times or seven hundred. Height is how busy a slice was, and the
       * only colour is a slice that contains a failure.
       */}
      <div className='mt-3 flex h-12 items-end gap-0.5' aria-label='Runs over the selected range'>
        {buckets.map((bucket) => {
          const lead =
            bucket.runs.find((run) => run.status === 'error') ?? bucket.runs[bucket.runs.length - 1]
          const unsettled = bucket.runs.every(
            (run) => run.status === 'running' || run.status === 'paused'
          )
          const height = Math.max(12, Math.round((bucket.runs.length / busiestBucket) * 100))

          return (
            <Tooltip.Root key={bucket.key}>
              <Tooltip.Trigger asChild>
                <button
                  type='button'
                  disabled={!lead}
                  onClick={() => lead && onSelectRun(lead)}
                  aria-label={
                    bucket.runs.length === 1 && lead
                      ? `${lead.label}, ${getStatusLabel(lead.status)}`
                      : `${bucket.runs.length} runs, ${bucket.failedCount} failed`
                  }
                  className='group flex h-full min-w-0 flex-1 items-end rounded-[2px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-primary)] disabled:cursor-default'
                >
                  <span
                    style={{ height: `${bucket.runs.length ? height : 6}%` }}
                    className={cn(
                      'w-full rounded-[2px] bg-[var(--border)] transition-opacity group-hover:opacity-70',
                      bucket.runs.length > 0 && 'bg-[var(--text-success)]',
                      unsettled && bucket.runs.length > 0 && 'bg-[var(--text-muted)]',
                      bucket.failedCount > 0 && 'bg-[var(--text-error)]'
                    )}
                  />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                {bucket.runs.length === 1 && lead ? (
                  <>
                    <span className='block'>{lead.label}</span>
                    <span className='block text-[var(--text-tertiary)]'>
                      {lead.summary} · {formatMs(lead.durationMs)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className='block'>
                      {bucket.runs.length} {bucket.runs.length === 1 ? 'run' : 'runs'}
                    </span>
                    <span className='block text-[var(--text-tertiary)]'>
                      {bucket.failedCount > 0 ? `${bucket.failedCount} failed` : 'All succeeded'}
                    </span>
                  </>
                )}
              </Tooltip.Content>
            </Tooltip.Root>
          )
        })}
      </div>
      <div className='mt-1.5 flex justify-between text-[var(--text-muted)] text-caption'>
        <span>{runs.length > 0 ? formatRunTime(runs[runs.length - 1].startedAt) : 'No runs'}</span>
        <span>Now</span>
      </div>
    </div>
  )
}
