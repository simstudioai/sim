'use client'

import { memo, type ReactNode, useLayoutEffect, useMemo, useRef } from 'react'
import { buttonVariants } from '@sim/emcn'
import { Loader, SquareArrowUpRight } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'
import Link from 'next/link'
import type { GetTableRowResponse } from '@/lib/api/contracts/tables'
import type { TableDefinition } from '@/lib/table'
import { columnTypeById } from '@/lib/table/column-types'
import { CellContent } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells'
import { ColumnTypeIcon } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/column-type-icon'
import { expandToDisplayColumns } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/utils'
import type { TimezoneState } from '@/hooks/queries/general-settings'

/**
 * Must match the sticky anchor's `h-[144px]` class below because the row
 * virtualizer reserves this exact height. The zero-width anchor stays sticky
 * across the full table width without JavaScript-driven positioning.
 */
export const REFERENCE_ROW_PREVIEW_HEIGHT = 144

const ReferenceIcon = columnTypeById('reference').icon

interface ReferenceRowPreviewBaseProps {
  workspaceId: string
  timeZone: string
  timezoneStatus: TimezoneState['status']
  referenceColumnsEnabled: boolean
  referenceTableId: string
  referenceTableNames: ReadonlyMap<string, string>
  colSpan: number
}

type ReferenceRowPreviewProps = ReferenceRowPreviewBaseProps &
  (
    | { status: 'loading' | 'error' }
    | {
        status: 'ready'
        table: TableDefinition
        row: GetTableRowResponse['data']['row'] | null
      }
  )

export const ReferenceRowPreview = memo(function ReferenceRowPreview(
  props: ReferenceRowPreviewProps
) {
  const {
    workspaceId,
    timeZone,
    timezoneStatus,
    referenceColumnsEnabled,
    referenceTableId,
    status,
    referenceTableNames,
    colSpan,
  } = props
  const table = status === 'ready' ? props.table : undefined
  const row = status === 'ready' ? props.row : undefined
  const previewCellRef = useRef<HTMLTableCellElement>(null)
  const previewShellRef = useRef<HTMLDivElement>(null)
  const previewViewportRef = useRef<HTMLDivElement>(null)
  const columns = useMemo(
    () => expandToDisplayColumns(table?.schema.columns ?? [], [], referenceTableNames),
    [table?.schema.columns, referenceTableNames]
  )

  useLayoutEffect(() => {
    const previewCell = previewCellRef.current
    const previewShell = previewShellRef.current
    const scrollRoot = previewCell?.closest<HTMLElement>('[data-table-scroll]')
    if (!previewCell || !previewShell || !scrollRoot) return

    let previousWidth: number | null = null
    let previousScrollLeft = scrollRoot.scrollLeft

    const updateWidth = () => {
      const cellBounds = previewCell.getBoundingClientRect()
      const viewportBounds = scrollRoot.getBoundingClientRect()
      const viewportLeft = viewportBounds.left + scrollRoot.clientLeft
      const viewportRight = viewportLeft + scrollRoot.clientWidth
      const visibleLeft = Math.max(cellBounds.left, viewportLeft)
      const visibleRight = Math.min(cellBounds.right, viewportRight)
      const width = Math.max(0, visibleRight - visibleLeft)
      if (width === previousWidth) return
      previousWidth = width
      previewShell.style.setProperty('--reference-preview-width', `${width}px`)
    }

    const handleScroll = () => {
      if (scrollRoot.scrollLeft === previousScrollLeft) return
      previousScrollLeft = scrollRoot.scrollLeft
      updateWidth()
    }

    updateWidth()
    scrollRoot.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth)
    resizeObserver?.observe(scrollRoot)
    resizeObserver?.observe(previewCell)

    return () => {
      scrollRoot.removeEventListener('scroll', handleScroll)
      resizeObserver?.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const previewViewport = previewViewportRef.current
    if (!previewViewport) return

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      previewViewport.scrollLeft += event.deltaX
    }

    previewViewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => previewViewport.removeEventListener('wheel', handleWheel)
  }, [status])

  let content: ReactNode
  if (columns.length === 0 && !row) {
    content = (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
        No matching row
      </div>
    )
  } else if (columns.length === 0) {
    content = (
      <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
        This table has no columns
      </div>
    )
  } else {
    content = (
      <div role='table' className='grid h-full w-full min-w-max grid-rows-2 text-small'>
        <div role='row' className='flex min-w-max'>
          {columns.map((column) => (
            <div
              role='columnheader'
              key={column.key}
              className='flex w-40 min-w-40 items-center border-[var(--border)] border-r border-b bg-[var(--bg)] px-2 font-normal'
            >
              <span className='flex min-w-0 items-center gap-1.5'>
                <ColumnTypeIcon type={column.type} />
                <span className='truncate text-[var(--text-secondary)]'>{column.name}</span>
              </span>
            </div>
          ))}
          <div
            aria-hidden
            className='min-w-0 flex-1 border-[var(--border)] border-b bg-[var(--bg)]'
          />
        </div>
        <div role='row' className='flex min-w-max'>
          {!row ? (
            <div
              role='cell'
              className='flex min-w-full flex-1 items-center justify-center text-[var(--text-muted)]'
            >
              No matching row
            </div>
          ) : (
            <>
              {columns.map((column) => (
                <div
                  role='cell'
                  key={column.key}
                  className='flex w-40 min-w-40 max-w-60 items-center border-[var(--border)] border-r px-2 text-[var(--text-primary)]'
                >
                  <div className='w-full min-w-0 max-w-56 overflow-clip text-ellipsis whitespace-nowrap'>
                    <CellContent
                      value={row.data[column.key]}
                      column={column}
                      workspaceId={workspaceId}
                      timeZone={timeZone}
                      timezoneStatus={timezoneStatus}
                      referenceColumnsEnabled={referenceColumnsEnabled}
                      isEditing={false}
                      onSave={noop}
                      onCancel={noop}
                    />
                  </div>
                </div>
              ))}
              <div aria-hidden className='min-w-0 flex-1 bg-[var(--bg)]' />
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <tr>
      <td
        ref={previewCellRef}
        colSpan={colSpan}
        className='overflow-clip border-[var(--border)] border-r border-b bg-[var(--surface-2)] p-0'
      >
        <div className='sticky left-0 h-[144px] w-0'>
          <div
            ref={previewShellRef}
            className='flex h-full w-[var(--reference-preview-width,100cqw)] min-w-0 flex-col bg-[var(--surface-2)]'
          >
            {status === 'loading' ? (
              <div className='flex h-full items-center justify-center'>
                <Loader animate className='size-[14px] text-[var(--text-muted)]' />
              </div>
            ) : status === 'error' ? (
              <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-small'>
                Couldn&apos;t load reference
              </div>
            ) : (
              <>
                <div className='flex h-9 shrink-0 items-center gap-1.5 px-3 text-[var(--text-primary)] text-small'>
                  <ReferenceIcon className='size-[14px] text-[var(--text-icon)]' />
                  <span>{table?.name}</span>
                  <Link
                    href={`/workspace/${workspaceId}/tables/${referenceTableId}`}
                    aria-label='Go to table'
                    title='Go to table'
                    data-reference-cell-trigger=''
                    className={buttonVariants({ variant: 'quiet', size: 'icon' })}
                  >
                    <SquareArrowUpRight className='size-[14px]' />
                  </Link>
                </div>

                <div
                  ref={previewViewportRef}
                  className='h-[72px] shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain border-[var(--border)] border-y bg-[var(--bg)]'
                >
                  {content}
                </div>

                <div aria-hidden className='h-9 shrink-0 bg-[var(--bg)]' />
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
})
