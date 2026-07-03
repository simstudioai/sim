'use client'

import React from 'react'
import { Button, Checkbox, cn } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { ADD_COL_WIDTH, CELL_HEADER_CHECKBOX, COL_WIDTH } from './constants'
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

export const SelectAllCheckbox = React.memo(function SelectAllCheckbox({
  checked,
  onCheckedChange,
  numRegionWidth,
}: {
  checked: boolean | 'indeterminate'
  onCheckedChange: () => void
  numRegionWidth: number
}) {
  return (
    <th
      className={cn(CELL_HEADER_CHECKBOX, 'cursor-pointer')}
      role='checkbox'
      aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
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
      <div className='flex items-center justify-center' style={{ width: numRegionWidth }}>
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
