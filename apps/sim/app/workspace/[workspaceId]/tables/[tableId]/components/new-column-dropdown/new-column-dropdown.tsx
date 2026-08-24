'use client'

import { useRef } from 'react'
import {
  ChipChevronDown,
  chipContentIconClass,
  chipContentLabelClass,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Plus,
} from '@sim/emcn'
import { Sparkles } from '@sim/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'
import { COLUMN_TYPE_OPTIONS } from '../column-config-sidebar'

const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-2 py-[7px] text-left align-middle'

interface NewColumnDropdownProps {
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

/**
 * "+ New column" dropdown — the single entry point for creating a column.
 * Lists every column type plus "Workflow" and "Enrichments". Picking a scalar
 * type adds a draft header cell for naming — nothing persists until the name
 * commits (committing a select's name opens its options sidebar, and it
 * persists from there). Workflow and Enrichments open their own sidebars.
 */
export function NewColumnDropdown({
  trigger,
  disabled,
  onPickType,
  onPickWorkflow,
  onPickEnrichment,
  blocked,
  onBlocked,
}: NewColumnDropdownProps) {
  const pendingTypeRef = useRef<ColumnDefinition['type'] | null>(null)

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
      {/* Taller than the 240px shared default: the full type list is 9 items
          (295px with its separator and padding), so the default cut the last
          two off behind a scrollbar. Sized here rather than in the shared
          component, which every other dropdown in the app relies on. */}
      {/* A type pick is deferred to here, the moment the menu has fully
          unmounted. Started from `onSelect`, the draft header's name input
          would mount while this menu is still playing its exit animation —
          and as the content zooms away from under the pointer, Radix's
          item-leave handler focuses the closing menu, stealing the input's
          focus mid-keystroke. The default close behavior (refocusing the
          trigger) is prevented for the same reason. */}
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        className='max-h-[320px]'
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          const type = pendingTypeRef.current
          pendingTypeRef.current = null
          if (type) onPickType(type)
        }}
      >
        <>
          <DropdownMenuItem onSelect={onPickEnrichment}>
            <Sparkles className='size-[14px] text-[var(--text-icon)]' />
            Enrichments
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
        {COLUMN_TYPE_OPTIONS.map((option) => {
          const Icon = option.icon
          const onSelect =
            option.type === 'workflow'
              ? onPickWorkflow
              : () => {
                  pendingTypeRef.current = option.type as ColumnDefinition['type']
                }
          return (
            <DropdownMenuItem key={option.type} onSelect={onSelect}>
              <Icon className='size-[14px] text-[var(--text-icon)]' />
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
