import type { ColumnDefinition } from '@/lib/table'

type BadgeVariant = 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'gray'

/**
 * Returns the appropriate badge color variant for a column type
 */
export function getTypeBadgeVariant(type: string): BadgeVariant {
  switch (type) {
    case 'string':
      return 'green'
    case 'number':
      return 'blue'
    case 'boolean':
      return 'purple'
    case 'json':
      return 'orange'
    case 'date':
      return 'teal'
    default:
      return 'gray'
  }
}

/**
 * Coerce a raw input value to the appropriate type for a column.
 * Throws on invalid JSON.
 */
export function cleanCellValue(value: unknown, column: ColumnDefinition): unknown {
  if (column.type === 'number') {
    return value === '' ? null : Number(value)
  }
  if (column.type === 'json') {
    if (typeof value === 'string') {
      if (value === '') return null
      return JSON.parse(value)
    }
    return value
  }
  if (column.type === 'boolean') {
    return Boolean(value)
  }
  return value || null
}

/**
 * Format a stored value for display in an input field.
 */
export function formatValueForInput(value: unknown, type: string): string {
  if (value === null || value === undefined) return ''
  if (type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  }
  if (type === 'date' && value) {
    try {
      const date = new Date(String(value))
      return date.toISOString().split('T')[0]
    } catch {
      return String(value)
    }
  }
  return String(value)
}
