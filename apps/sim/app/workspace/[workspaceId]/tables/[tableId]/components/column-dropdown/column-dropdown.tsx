'use client'

import {
  ChipChevronDown,
  chipContentIconClass,
  chipContentLabelClass,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Plus,
  Tooltip,
} from '@sim/emcn'
import { Sparkles } from '@sim/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'
import { type ColumnTypeOption, columnTypeOptionsForTable } from '../column-config-sidebar'

const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-2 py-[7px] text-left align-middle'

interface ColumnDropdownProps {
  columns: readonly ColumnDefinition[]
  tableRowTtlEnabled: boolean
  /** `'header'` renders the page-header trigger (subtle Button); `'inline-header'` renders
   *  the in-table column-header `<th>` trigger. Same dropdown content either way. */
  trigger: 'header' | 'inline-header'
  disabled: boolean
  onPickType: (type: ColumnDefinition['type']) => void
  onPickWorkflow: () => void
  onPickEnrichment: () => void
  /**
   * When true, the trigger stays visible and clickable but opens nothing — it
   * calls {@link onBlocked} instead. Used when the table is schema-locked:
   * hiding the control leaves the user guessing, so it stays and explains.
   * Paired required so `blocked` can never be set without a handler.
   */
  blocked: boolean
  onBlocked: () => void
}

interface ColumnTypeMenuItemProps {
  option: ColumnTypeOption
  onSelect: () => void
}

function ColumnTypeMenuItem({ option, onSelect }: ColumnTypeMenuItemProps) {
  const Icon = option.icon
  const item = (
    <DropdownMenuItem
      aria-disabled={option.disabledReason ? true : undefined}
      className={
        option.disabledReason ? 'cursor-not-allowed opacity-50 focus:bg-transparent' : undefined
      }
      onSelect={(event) => {
        if (option.disabledReason) {
          event.preventDefault()
          return
        }
        onSelect()
      }}
    >
      <Icon className='size-[14px] text-[var(--text-icon)]' />
      {option.label}
    </DropdownMenuItem>
  )

  if (!option.disabledReason) return item

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{item}</Tooltip.Trigger>
      <Tooltip.Content>{option.disabledReason}</Tooltip.Content>
    </Tooltip.Root>
  )
}

/**
 * "+ New column" dropdown — the single entry point for creating a column.
 * Lists every column type plus "Workflow" and "Enrichments"; picking a type
 * opens the right sidebar pre-seeded.
 */
export function ColumnDropdown({
  columns,
  tableRowTtlEnabled,
  trigger,
  disabled,
  onPickType,
  onPickWorkflow,
  onPickEnrichment,
  blocked,
  onBlocked,
}: ColumnDropdownProps) {
  const triggerButton =
    trigger === 'header' ? (
      <button
        type='button'
        className={chipVariants()}
        disabled={disabled}
        onClick={blocked ? onBlocked : undefined}
      >
        <Plus className={chipContentIconClass} />
        <span className={chipContentLabelClass}>New column</span>
        <ChipChevronDown />
      </button>
    ) : (
      <button
        type='button'
        className='flex h-[20px] cursor-pointer items-center gap-2 outline-none'
        disabled={disabled}
        onClick={blocked ? onBlocked : undefined}
      >
        <Plus className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='text-[var(--text-body)] text-small'>New column</span>
      </button>
    )

  if (blocked) {
    return trigger === 'inline-header' ? (
      <th className={CELL_HEADER}>{triggerButton}</th>
    ) : (
      triggerButton
    )
  }

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='bottom' sideOffset={4}>
        {columnTypeOptionsForTable(columns, undefined, { tableRowTtlEnabled }).map((option) => {
          const onSelect =
            option.type === 'workflow'
              ? onPickWorkflow
              : () => onPickType(option.type as ColumnDefinition['type'])
          return <ColumnTypeMenuItem key={option.type} option={option} onSelect={onSelect} />
        })}
        <DropdownMenuItem onSelect={onPickEnrichment}>
          <Sparkles className='size-[14px] text-[var(--text-icon)]' />
          Enrichments
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  // The in-table trigger lives inside a `<tr>` so it must be a `<th>`. The
  // header trigger lives in the page header so it sits inline.
  return trigger === 'inline-header' ? <th className={CELL_HEADER}>{menu}</th> : menu
}
