'use client'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Plus } from '@/components/emcn/icons'
import { isWorkflowColumnsEnabledClient } from '@/lib/core/config/feature-flags'
import type { ColumnDefinition } from '@/lib/table'
import { COLUMN_TYPE_OPTIONS } from '../column-config-sidebar'

const VISIBLE_COLUMN_TYPE_OPTIONS = isWorkflowColumnsEnabledClient
  ? COLUMN_TYPE_OPTIONS
  : COLUMN_TYPE_OPTIONS.filter((o) => o.type !== 'workflow')

const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-2 py-[7px] text-left align-middle'

const HEADER_ADD_COLUMN_ICON = <Plus className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />

interface NewColumnDropdownProps {
  /** `'header'` renders the page-header trigger (subtle Button); `'inline-header'` renders
   *  the in-table column-header `<th>` trigger. Same dropdown content either way. */
  trigger: 'header' | 'inline-header'
  disabled: boolean
  onPickType: (type: ColumnDefinition['type']) => void
  onPickWorkflow: () => void
}

/**
 * "+ New column" dropdown — the single entry point for creating a column.
 * Lists every column type plus "Workflow"; picking a type opens the right
 * sidebar pre-seeded.
 */
export function NewColumnDropdown({
  trigger,
  disabled,
  onPickType,
  onPickWorkflow,
}: NewColumnDropdownProps) {
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger === 'header' ? (
          <Button variant='subtle' className='px-2 py-1 text-caption' disabled={disabled}>
            {HEADER_ADD_COLUMN_ICON}
            New column
          </Button>
        ) : (
          <button
            type='button'
            className='flex h-[20px] cursor-pointer items-center gap-2 outline-none'
            disabled={disabled}
          >
            <Plus className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
            <span className='font-medium text-[var(--text-body)] text-small'>New column</span>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='bottom' sideOffset={4}>
        {VISIBLE_COLUMN_TYPE_OPTIONS.map((option) => {
          const Icon = option.icon
          const onSelect =
            option.type === 'workflow'
              ? onPickWorkflow
              : () => onPickType(option.type as ColumnDefinition['type'])
          return (
            <DropdownMenuItem key={option.type} onSelect={onSelect}>
              <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
              {option.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  // The in-table trigger lives inside a `<tr>` so it must be a `<th>`. The
  // header trigger lives in the page header so it sits inline.
  return trigger === 'inline-header' ? <th className={CELL_HEADER}>{menu}</th> : menu
}
