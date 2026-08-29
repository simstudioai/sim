'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from '@sim/emcn/icons'
import type { FilterTag, SearchConfig, SortConfig } from '@/app/workspace/[workspaceId]/components'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import {
  formatMs,
  formatRunTime,
  formatUsd,
  getRunsInRange,
  getVisibleRuns,
  type PrototypeRun,
  RUN_RANGES,
  RUN_SORT_COLUMNS,
  RUN_STATUS_OPTIONS,
  RUN_TRIGGER_OPTIONS,
  type RunRange,
  type RunSortState,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/prototype-data'
import { StatusIcon } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/run-status'
import { RunsFilterPanel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/runs-filter-panel'

/**
 * The panel's landing view: the workflow's runs, newest first. Picking one is
 * what opens its snapshot.
 *
 * The cross-run summary that used to sit above this list now lives in
 * {@link import('./run-health').RunHealth}, staged for the workspace Logs page.
 */

interface RunRowProps {
  run: PrototypeRun
  onSelect: (run: PrototypeRun) => void
}

function RunRow({ run, onSelect }: RunRowProps) {
  return (
    <button
      type='button'
      onClick={() => onSelect(run)}
      className='group flex w-full gap-2 border-[var(--border)] border-b px-3 py-2.5 text-start transition-colors last:border-b-0 hover-hover:bg-[var(--surface-active)] focus-visible:bg-[var(--surface-active)] focus-visible:outline-none'
    >
      {/* Centred on the title's line box, not the whole row, so it reads as that line's marker. */}
      <span className='mt-[3px] flex-none'>
        <StatusIcon status={run.status} />
      </span>
      {/* Label and its metadata are one block, indented together off the status column. */}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        {/*
         * The chevron is out of flow so the duration can sit against the row's own
         * padding at rest; on hover it slides left by exactly the chevron's width
         * as the chevron fades in, rather than the row holding a permanent gap for
         * something that is usually invisible.
         */}
        <div className='relative flex w-full min-w-0 items-center gap-2'>
          <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] text-sm leading-5'>
            {run.label}
          </span>
          <span className='group-hover:-translate-x-[18px] flex-none text-[var(--text-tertiary)] text-caption tabular-nums transition-transform duration-200 ease-out motion-reduce:transition-none'>
            {formatMs(run.durationMs)}
          </span>
          <ChevronRight className='-translate-y-1/2 absolute end-0 top-1/2 size-[14px] text-[var(--text-icon)] opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 motion-reduce:transition-none' />
        </div>
        <div className='flex min-w-0 items-center gap-1.5 text-[var(--text-tertiary)] text-caption'>
          <span className='truncate'>{formatRunTime(run.startedAt)}</span>
          <span aria-hidden='true'>·</span>
          <span className='flex-none'>{run.trigger}</span>
          <span aria-hidden='true'>·</span>
          <span className='flex-none tabular-nums'>{formatUsd(run.costUsd)}</span>
        </div>
      </div>
    </button>
  )
}

const SORT_OPTIONS = RUN_SORT_COLUMNS.map((column) => ({ ...column }))

export function RunsOverview({ onSelectRun }: { onSelectRun: (run: PrototypeRun) => void }) {
  const [range, setRange] = useState<RunRange>('all')
  const [query, setQuery] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [triggers, setTriggers] = useState<string[]>([])
  const [sort, setSort] = useState<RunSortState>(null)

  const inRange = useMemo(() => getRunsInRange(range), [range])
  const runs = useMemo(
    () => getVisibleRuns(inRange, { query, statuses, triggers, sort }),
    [inRange, query, statuses, triggers, sort]
  )

  const searchConfig = useMemo<SearchConfig>(
    () => ({
      value: query,
      onChange: setQuery,
      placeholder: 'Search runs...',
      onClearAll: () => setQuery(''),
      /*
       * The panel's tab strip carries a magnifier on Toolbar directly above this
       * bar. A second one a row below read as two separate searches, so the
       * placeholder does the naming here on its own.
       */
      hideIcon: true,
    }),
    [query]
  )

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: SORT_OPTIONS,
      active: sort,
      onSort: (column, direction) => setSort({ column, direction }),
      onClear: () => setSort(null),
    }),
    [sort]
  )

  /* Every applied filter is removable from the bar, as it is on the Logs page. */
  const filterTags = useMemo<FilterTag[]>(() => {
    const tags: FilterTag[] = []
    for (const status of statuses) {
      tags.push({
        label: RUN_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status,
        onRemove: () => setStatuses((current) => current.filter((value) => value !== status)),
      })
    }
    for (const trigger of triggers) {
      tags.push({
        label: RUN_TRIGGER_OPTIONS.find((option) => option.value === trigger)?.label ?? trigger,
        onRemove: () => setTriggers((current) => current.filter((value) => value !== trigger)),
      })
    }
    if (range !== 'all') {
      tags.push({
        label: RUN_RANGES.find((option) => option.value === range)?.label ?? range,
        onRemove: () => setRange('all'),
      })
    }
    return tags
  }, [statuses, triggers, range])

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden'>
      {/*
       * The Logs page's own controls bar, not a narrow re-creation of it: same
       * search field, same Filter popover, same Sort menu, so the two surfaces
       * behave identically on the thing they both list.
       */}
      <Resource.Options
        size='sm'
        search={searchConfig}
        sort={sortConfig}
        filter={{
          content: (
            <RunsFilterPanel
              statuses={statuses}
              onStatusesChange={setStatuses}
              triggers={triggers}
              onTriggersChange={setTriggers}
              range={range}
              onRangeChange={setRange}
            />
          ),
          active: filterTags.length > 0,
        }}
        filterTags={filterTags}
      />

      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {runs.length === 0 ? (
            <p className='px-3 py-6 text-center text-[var(--text-muted)] text-caption'>
              No runs match these filters
            </p>
          ) : (
            runs.map((run) => <RunRow key={run.id} run={run} onSelect={onSelectRun} />)
          )}
        </div>
      </div>
    </div>
  )
}
