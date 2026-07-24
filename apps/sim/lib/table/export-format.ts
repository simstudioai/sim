/**
 * Shared serialization for table exports — used by both the synchronous streaming export route
 * (small tables) and the background export job worker (large tables), so the two paths produce
 * byte-identical files.
 */

import type { ColumnDefinition } from '@/lib/table/types'

/**
 * Maps a `select` cell's stored option id(s) to their display names — exports
 * should read the human-readable label, never the internal id. Single columns
 * return the option name (or null); multi columns return an array of names.
 * Ids with no matching option (deleted) are dropped.
 */
export function resolveSelectExportValue(
  column: ColumnDefinition,
  value: unknown
): string | string[] | null {
  const byId = new Map((column.options ?? []).map((o) => [o.id, o.name]))
  const ids = Array.isArray(value)
    ? value
    : typeof value === 'string' && value !== ''
      ? [value]
      : []
  const names = ids
    .map((id) => (typeof id === 'string' ? byId.get(id) : undefined))
    .filter((n): n is string => n != null)
  return column.multiple ? names : (names[0] ?? null)
}

export function sanitizeExportFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'table'
}

/**
 * Prefixes a single quote to values starting with a spreadsheet formula trigger
 * (`=`, `+`, `-`, `@`, tab, CR), neutralizing CSV injection in Excel/Sheets.
 */
export function neutralizeCsvFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * Serializes a cell for CSV. Only string cells are formula-neutralized; numbers,
 * booleans, dates, and JSON objects can never form a trigger and pass through verbatim.
 */
export function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string') return neutralizeCsvFormula(value)
  return String(value)
}

/**
 * Serializes one cell for CSV, resolving `select` option ids to their names
 * (comma-joined for multi) so the file shows the enum label, not the id.
 */
export function formatCsvCell(column: ColumnDefinition, value: unknown): string {
  if (column.type === 'select') {
    const resolved = resolveSelectExportValue(column, value)
    const text = Array.isArray(resolved) ? resolved.join(', ') : (resolved ?? '')
    return neutralizeCsvFormula(text)
  }
  return formatCsvValue(value)
}

export function toCsvRow(values: string[]): string {
  return values.map(escapeCsvField).join(',')
}

function escapeCsvField(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}
