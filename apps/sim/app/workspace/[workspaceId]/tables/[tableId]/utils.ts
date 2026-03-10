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
    if (value === '') return null
    const num = Number(value)
    return Number.isNaN(num) ? 0 : num
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
  if (column.type === 'date') {
    if (value === '' || value === null || value === undefined) return null
    const str = String(value)
    return Number.isNaN(Date.parse(str)) ? null : str
  }
  return value || null
}

/**
 * Format a stored value for display in an input field.
 */
export function formatValueForInput(value: unknown, type: string): string {
  if (value === null || value === undefined) return ''
  if (type === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  if (type === 'date' && value) {
    const str = String(value)
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) return match[0]
    try {
      const date = new Date(str)
      return date.toISOString().split('T')[0]
    } catch {
      return str
    }
  }
  return String(value)
}

/**
 * Convert a stored YYYY-MM-DD date string to MM/DD/YYYY display format.
 */
export function storageToDisplay(stored: string): string {
  const match = stored.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[2]}/${match[3]}/${match[1]}`
  return stored
}

/**
 * Convert a MM/DD/YYYY (or MM/DD) display string back to YYYY-MM-DD storage format.
 */
export function displayToStorage(display: string): string | null {
  const iso = display.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const month = Number(iso[2])
    const day = Number(iso[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return display
  }
  const full = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (full) {
    const month = Number(full[1])
    const day = Number(full[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${full[3]}-${full[1].padStart(2, '0')}-${full[2].padStart(2, '0')}`
  }
  const partial = display.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (partial) {
    const month = Number(partial[1])
    const day = Number(partial[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${new Date().getFullYear()}-${partial[1].padStart(2, '0')}-${partial[2].padStart(2, '0')}`
  }
  return null
}
