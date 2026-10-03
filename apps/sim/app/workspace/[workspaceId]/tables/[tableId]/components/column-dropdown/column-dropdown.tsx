'use client'

import {
  ChipChevronDown,
  chipContentIconClass,
  chipContentLabelClass,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from '@sim/emcn'
import { Lock, Plus, Sparkles } from '@sim/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'
import {
  type ColumnTypeOption,
  columnTypeOptionsForTable,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/column-config-sidebar'
import { LOCK_TOOLTIPS } from '@/app/workspace/[workspaceId]/tables/[tableId]/lock-copy'

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
  /** A schema lock disables the action and explains why on hover or focus. */
  blocked: boolean
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
      className={cn(option.disabledReason && 'cursor-not-allowed opacity-50 focus:bg-transparent')}
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
}: ColumnDropdownProps) {
  const Icon = blocked ? Lock : Plus
  const triggerButton =
    trigger === 'header' ? (
      <button
        type='button'
        className={cn(chipVariants(), blocked && 'cursor-not-allowed opacity-60')}
        disabled={disabled}
        aria-disabled={blocked || undefined}
      >
        <Icon className={chipContentIconClass} />
        <span className={chipContentLabelClass}>New column</span>
        <ChipChevronDown />
      </button>
    ) : (
      <button
        type='button'
        className={cn(
          'flex h-[20px] items-center gap-2 outline-hidden',
          blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        )}
        disabled={disabled}
        aria-disabled={blocked || undefined}
      >
        <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='text-[var(--text-body)] text-small'>New column</span>
      </button>
    )

  if (blocked) {
    const lockedTrigger = (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{triggerButton}</Tooltip.Trigger>
        <Tooltip.Content>{LOCK_TOOLTIPS.schema}</Tooltip.Content>
      </Tooltip.Root>
    )
    return trigger === 'inline-header' ? (
      <th className={CELL_HEADER}>{lockedTrigger}</th>
    ) : (
      lockedTrigger
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
