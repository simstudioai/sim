'use client'

import { Badge, cn } from '@sim/emcn'
import type { ColumnDefinition, SelectOption } from '@/lib/table'

/** Reads the selected option ids from a stored cell value of either select type. */
export function toSelectedIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

/**
 * Resolves the stored ids of a `select`/`multiselect` cell to their declared
 * options, preserving selection order. An id with no matching option (stale
 * after an option was deleted) resolves to a neutral gray fallback so the cell
 * never renders blank.
 */
export function resolveSelectOptions(column: ColumnDefinition, value: unknown): SelectOption[] {
  const options = column.options ?? []
  return toSelectedIds(value).map(
    (id) => options.find((o) => o.id === id) ?? { id, name: id, color: 'gray' }
  )
}

interface SelectPillProps {
  option: SelectOption
  size?: 'sm' | 'md'
  className?: string
}

/** A single colored option pill, rendered through the shared `Badge` palette. */
export function SelectPill({ option, size = 'sm', className }: SelectPillProps) {
  return (
    <Badge variant={option.color} size={size} className={cn('max-w-full', className)}>
      <span className='truncate'>{option.name}</span>
    </Badge>
  )
}
