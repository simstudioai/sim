'use client'

import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Check,
  Chip,
  ChipDatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import type { CalendarScope } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'
import { useTranslations } from 'next-intl'

const SCOPE_OPTIONS: { value: CalendarScope; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

interface CalendarToolbarProps {
  scope: CalendarScope
  anchor: Date
  label: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSelectDate: (date: Date) => void
  onScopeChange: (scope: CalendarScope) => void
}

/**
 * Calendar ribbon: a "Today" jump and the period-label date picker on the left;
 * the prev/next chevrons and the scope picker on the right. The controls are
 * bare chips — the period label is a ghost `ChipDatePicker` that jumps the view
 * to any picked date — and the scope picker is a `DropdownMenu`, matching the
 * Filter/Sort menus on the resource options bar.
 */
export function CalendarToolbar({
  scope,
  anchor,
  label,
  onPrev,
  onNext,
  onToday,
  onSelectDate,
  onScopeChange,
}: CalendarToolbarProps) {
  const t = useTranslations('auto')
  const scopeLabel = SCOPE_OPTIONS.find((option) => option.value === scope)?.label ?? 'Week'

  return (
    <div className='flex items-center justify-between border-[var(--border)] border-b px-4 py-2.5'>
      <div className='flex items-center'>
        <Chip onClick={onToday}>{t('today')}</Chip>
        <ChipDatePicker
          variant='ghost'
          label={label}
          value={format(anchor, 'yyyy-MM-dd')}
          onChange={(value) => onSelectDate(parseISO(value))}
        />
      </div>
      <div className='flex items-center'>
        <Chip leftIcon={ChevronLeft} aria-label={t('previous')} onClick={onPrev} />
        <Chip leftIcon={ChevronRight} aria-label={t('next')} onClick={onNext} />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Chip>{scopeLabel}</Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' alignOffset={6}>
            {SCOPE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.value} onSelect={() => onScopeChange(option.value)}>
                {option.label}
                {option.value === scope && (
                  <Check className='ml-auto size-[12px] text-[var(--text-tertiary)]' />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
