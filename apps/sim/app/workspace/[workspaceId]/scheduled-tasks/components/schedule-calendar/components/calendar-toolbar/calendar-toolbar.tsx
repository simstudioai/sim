'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Check,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import type { CalendarScope } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'

const SCOPE_OPTIONS: { value: CalendarScope; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

interface CalendarToolbarProps {
  scope: CalendarScope
  label: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onScopeChange: (scope: CalendarScope) => void
}

/**
 * Calendar ribbon: a "Today" jump and the period label on the left; the prev/next
 * chevrons and the scope picker on the right. The controls are bare chips and the
 * scope picker is a `DropdownMenu`, matching the Filter/Sort menus on the
 * resource options bar.
 */
export function CalendarToolbar({
  scope,
  label,
  onPrev,
  onNext,
  onToday,
  onScopeChange,
}: CalendarToolbarProps) {
  const scopeLabel = SCOPE_OPTIONS.find((option) => option.value === scope)?.label ?? 'Week'

  return (
    <div className='flex items-center justify-between border-[var(--border)] border-b px-4 py-2.5'>
      <div className='flex items-center'>
        <Chip onClick={onToday}>Today</Chip>
        <span className='ml-0.5 text-[var(--text-body)] text-sm'>{label}</span>
      </div>
      <div className='flex items-center'>
        <Chip leftIcon={ChevronLeft} aria-label='Previous' onClick={onPrev} />
        <Chip leftIcon={ChevronRight} aria-label='Next' onClick={onNext} />
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
