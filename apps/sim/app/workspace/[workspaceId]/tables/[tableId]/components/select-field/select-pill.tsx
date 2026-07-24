'use client'

import { Badge, cn } from '@sim/emcn'
import type { ColumnDefinition, SelectOption } from '@/lib/table'

/** Reads the raw stored option ids from a cell value (single string or array). */
export function toSelectedIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

/**
 * Resolves a `select` cell's stored ids to their declared options, preserving
 * selection order. An id with no matching option — stale after that option was
 * deleted — is dropped, so the cell falls back to empty ("None") rather than
 * showing an orphaned reference.
 */
export function resolveSelectOptions(column: ColumnDefinition, value: unknown): SelectOption[] {
  const byId = new Map((column.options ?? []).map((o) => [o.id, o]))
  return toSelectedIds(value)
    .map((id) => byId.get(id))
    .filter((o): o is SelectOption => o != null)
}

/** The still-valid option ids of a cell (orphaned/removed ids dropped). */
export function selectedOptionIds(column: ColumnDefinition, value: unknown): string[] {
  return resolveSelectOptions(column, value).map((o) => o.id)
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
