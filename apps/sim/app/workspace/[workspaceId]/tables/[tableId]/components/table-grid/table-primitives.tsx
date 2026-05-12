'use client'

import React from 'react'
import { Button, Checkbox, Skeleton } from '@/components/emcn'
import { Plus } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  ADD_COL_WIDTH,
  CELL,
  CELL_CHECKBOX,
  CELL_HEADER_CHECKBOX,
  COL_WIDTH,
  SKELETON_ROW_COUNT,
} from './constants'
import type { DisplayColumn } from './types'

export const TableColGroup = React.memo(function TableColGroup({
  columns,
  columnWidths,
  checkboxColWidth,
}: {
  columns: DisplayColumn[]
  columnWidths: Record<string, number>
  checkboxColWidth: number
}) {
  return (
    <colgroup>
      <col style={{ width: checkboxColWidth }} />
      {columns.map((col) => (
        <col key={col.key} style={{ width: columnWidths[col.key] ?? COL_WIDTH }} />
      ))}
      <col style={{ width: ADD_COL_WIDTH }} />
    </colgroup>
  )
})

export const TableBodySkeleton = React.memo(function TableBodySkeleton({
  colCount,
}: {
  colCount: number
}) {
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          <td className={cn(CELL_CHECKBOX, 'text-center')}>
            <div className='flex min-h-[20px] items-center justify-center'>
              <span className='text-[var(--text-tertiary)] text-xs tabular-nums'>
                {rowIndex + 1}
              </span>
            </div>
          </td>
          {Array.from({ length: colCount }).map((_, colIndex) => {
            const width = 72 + ((rowIndex + colIndex) % 4) * 24
            return (
              <td key={colIndex} className={CELL}>
                <div className='flex min-h-[20px] items-center'>
                  <Skeleton className='h-[16px]' style={{ width: `${width}px` }} />
                </div>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
})

export const SelectAllCheckbox = React.memo(function SelectAllCheckbox({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: () => void
}) {
  return (
    <th
      className={cn(CELL_HEADER_CHECKBOX, 'cursor-pointer')}
      role='checkbox'
      aria-checked={checked}
      tabIndex={0}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        onCheckedChange()
      }}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return
        e.preventDefault()
        onCheckedChange()
      }}
    >
      <div className='flex items-center justify-center'>
        <Checkbox size='sm' checked={checked} className='pointer-events-none' />
      </div>
    </th>
  )
})

export const AddRowButton = React.memo(function AddRowButton({ onClick }: { onClick: () => void }) {
  return (
    <div className='px-2 py-[7px]'>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-[20px] gap-2 p-0 text-[var(--text-body)]'
        onClick={onClick}
      >
        <Plus className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='font-medium text-small'>New row</span>
      </Button>
    </div>
  )
})
