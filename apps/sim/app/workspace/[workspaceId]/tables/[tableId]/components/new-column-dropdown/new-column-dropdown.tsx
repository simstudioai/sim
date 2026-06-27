'use client'

import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
} from '@/components/emcn'
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
}

/**
 * "+ New column" dropdown — the single entry point for creating a column.
 * Lists every column type plus "Workflow" and "Enrichments"; picking a type
 * opens the right sidebar pre-seeded.
 */
export function NewColumnDropdown({
  trigger,
  disabled,
  onPickType,
  onPickWorkflow,
  onPickEnrichment,
}: NewColumnDropdownProps) {
  const t = useTranslations('auto')
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger === 'header' ? (
          <button type='button' className={chipVariants()} disabled={disabled}>
            <Plus className={chipContentIconClass} />
            <span className={chipContentLabelClass}>{t('new_column')}</span>
            <ChipChevronDown />
          </button>
        ) : (
          <button
            type='button'
            className='flex h-[20px] cursor-pointer items-center gap-2 outline-none'
            disabled={disabled}
          >
            <Plus className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            <span className='font-medium text-[var(--text-body)] text-small'>
              {t('new_column')}
            </span>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='bottom' sideOffset={4}>
        <>
          <DropdownMenuItem onSelect={onPickEnrichment}>
            <Sparkles className='size-[14px] text-[var(--text-icon)]' />
            {t('enrichments')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
        {COLUMN_TYPE_OPTIONS.map((option) => {
          const Icon = option.icon
          const onSelect =
            option.type === 'workflow'
              ? onPickWorkflow
              : () => onPickType(option.type as ColumnDefinition['type'])
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
