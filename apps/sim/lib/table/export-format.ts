/**
 * Shared serialization for table exports — used by both the synchronous streaming export route
 * (small tables) and the background export job worker (large tables), so the two paths produce
 * byte-identical files.
 */

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

export function toCsvRow(values: string[]): string {
  return values.map(escapeCsvField).join(',')
}

function escapeCsvField(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}
