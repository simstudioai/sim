'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Badge, Chip, ChipDropdown, ChipInput } from '@sim/emcn'
import { Library, ListFilter, Search, X } from '@sim/emcn/icons'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { LogPreviewDetails } from '@/app/(landing)/logs/components/log-history-preview/components/log-preview-details'
import { PREVIEW_RUNS } from '@/app/(landing)/logs/components/log-history-preview/constants'
import {
  Resource,
  type ResourceColumn,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

const COLUMNS: ResourceColumn[] = [
  { id: 'workflow', header: 'Workflow', widthMultiplier: 1.4 },
  { id: 'date', header: 'Date' },
  { id: 'status', header: 'Status' },
  { id: 'cost', header: 'Cost' },
  { id: 'trigger', header: 'Trigger' },
  { id: 'duration', header: 'Duration' },
]
const FILTERS = [
  { value: 'All', label: 'All statuses' },
  { value: 'Completed', label: 'Info' },
  { value: 'Error', label: 'Error' },
]

/** Production Resource.Table with the same log columns and native run-details sidebar. */
export function LogHistoryPreview() {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const rowButtonsRef = useRef<Map<string, HTMLButtonElement> | null>(null)
  const rowButtons = (rowButtonsRef.current ??= new Map())
  const detailsId = useId()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const visibleRuns = PREVIEW_RUNS.filter(
    (run) =>
      (filter === 'All' || run.status === filter) &&
      run.name.toLowerCase().includes(query.toLowerCase())
  )
  const selectedRun = visibleRuns.find((run) => run.id === selectedId)

  useEffect(() => {
    if (selectedRun) closeButtonRef.current?.focus({ preventScroll: true })
  }, [selectedRun])

  function closeDetails() {
    setSelectedId(null)
    if (selectedId) rowButtons.get(selectedId)?.focus({ preventScroll: true })
  }

  const rows = visibleRuns.map((run) => ({
    id: run.id,
    cells: {
      workflow: {
        content: (
          <button
            ref={(node) => {
              if (node) rowButtons.set(run.id, node)
              else rowButtons.delete(run.id)
            }}
            type='button'
            aria-controls={selectedRun?.id === run.id ? detailsId : undefined}
            aria-expanded={selectedRun?.id === run.id}
            onClick={(event) => {
              event.stopPropagation()
              setSelectedId(run.id)
            }}
            className='max-w-full cursor-pointer truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-[var(--text-secondary)]'
          >
            {run.name}
          </button>
        ),
      },
      date: { label: `Sep 7 ${run.time}` },
      status: {
        content: (
          <Badge variant='gray' dot size='sm'>
            {run.status === 'Error' ? 'Error' : 'Info'}
          </Badge>
        ),
      },
      cost: { label: `${run.credits} ${run.credits === '1' ? 'credit' : 'credits'}` },
      trigger: {
        content: (
          <Badge variant='gray' size='sm' className='shrink-0 whitespace-nowrap'>
            {run.trigger}
          </Badge>
        ),
      },
      duration: { label: run.duration },
    },
  }))

  return (
    <>
      <div className='absolute top-20 right-[8%] bottom-8 left-[8%] isolate flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs max-sm:inset-x-5 max-sm:top-8 [&_[data-menu-preview-toolbar]>div]:max-w-none'>
        <MenuPreviewHeader icon={Library} title='Logs' />
        <MenuPreviewToolbar>
          <ChipInput
            icon={Search}
            placeholder='Search logs...'
            aria-label='Search sample logs'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='mr-auto min-w-0 flex-1'
          />
          <ChipDropdown
            leftIcon={ListFilter}
            aria-label={`Filter sample logs by status: ${FILTERS.find((option) => option.value === filter)?.label ?? filter}`}
            value={filter}
            options={FILTERS}
            onChange={setFilter}
            matchTriggerWidth={false}
          />
        </MenuPreviewToolbar>
        <div className='relative flex min-h-0 flex-1 flex-col'>
          <Resource.Table
            columns={COLUMNS}
            rows={rows}
            selectedRowId={selectedRun?.id}
            onRowClick={setSelectedId}
            emptyState={<p className='p-6 text-[var(--text-secondary)]'>No matching runs</p>}
            overlay={
              selectedRun && (
                <div
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      closeDetails()
                    }
                  }}
                  className='absolute inset-y-0 right-0 z-10 flex w-[480px] max-w-full flex-col border-[var(--border)] border-l bg-[var(--bg)] shadow-sm'
                >
                  <MenuPreviewHeader
                    title='Log Details'
                    size='table'
                    actions={
                      <Chip
                        ref={closeButtonRef}
                        leftIcon={X}
                        aria-label='Close sample log details'
                        onClick={closeDetails}
                      />
                    }
                  />
                  <LogPreviewDetails key={selectedRun.id} id={detailsId} run={selectedRun} />
                </div>
              )
            }
          />
        </div>
      </div>
    </>
  )
}
