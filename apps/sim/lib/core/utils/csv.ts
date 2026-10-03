/**
 * Prefixes a single quote to values starting with a spreadsheet formula trigger
 * (`=`, `+`, `-`, `@`, tab, CR), neutralizing CSV injection in Excel/Sheets.
 */
export function neutralizeCsvFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function formatCsvValue(
  value: unknown,
  serializeObject: (value: object) => string | undefined = JSON.stringify
): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return serializeObject(value) ?? ''
  if (typeof value === 'string') return neutralizeCsvFormula(value)
  return String(value)
}

export function toCsvRow(values: string[]): string {
  return values.map(escapeCsvField).join(',')
}

function escapeCsvField(field: string): string {
  return /[",\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field
}
