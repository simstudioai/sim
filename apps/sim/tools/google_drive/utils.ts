export const GOOGLE_WORKSPACE_MIME_TYPES = [
  'application/vnd.google-apps.document', // Google Docs
  'application/vnd.google-apps.spreadsheet', // Google Sheets
  'application/vnd.google-apps.presentation', // Google Slides
  'application/vnd.google-apps.drawing', // Google Drawings
  'application/vnd.google-apps.form', // Google Forms
  'application/vnd.google-apps.script', // Google Apps Scripts
]

export const DEFAULT_EXPORT_FORMATS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.drawing': 'image/png',
  'application/vnd.google-apps.form': 'application/pdf',
  'application/vnd.google-apps.script': 'application/json',
}

export const SOURCE_MIME_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/vnd.ms-powerpoint',
}

export function handleSheetsFormat(input: unknown): {
  csv?: string
  rowCount: number
  columnCount: number
} {
  let workingValue: unknown = input

  if (typeof workingValue === 'string') {
    try {
      workingValue = JSON.parse(workingValue)
    } catch (_error) {
      const csvString = workingValue as string
      return { csv: csvString, rowCount: 0, columnCount: 0 }
    }
  }

  if (!Array.isArray(workingValue)) {
    return { rowCount: 0, columnCount: 0 }
  }

  let table: unknown[] = workingValue

  if (
    table.length > 0 &&
    typeof (table as any)[0] === 'object' &&
    (table as any)[0] !== null &&
    !Array.isArray((table as any)[0])
  ) {
    const allKeys = new Set<string>()
    ;(table as any[]).forEach((obj) => {
      if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach((key) => allKeys.add(key))
      }
    })
    const headers = Array.from(allKeys)
    const rows = (table as any[]).map((obj) => {
      if (!obj || typeof obj !== 'object') {
        return Array(headers.length).fill('')
      }
      return headers.map((key) => {
        const value = (obj as Record<string, unknown>)[key]
        if (value !== null && typeof value === 'object') {
          return JSON.stringify(value)
        }
        return value === undefined ? '' : (value as any)
      })
    })
    table = [headers, ...rows]
  }

  const escapeCell = (cell: unknown): string => {
    if (cell === null || cell === undefined) return ''
    const stringValue = String(cell)
    const mustQuote = /[",\n\r]/.test(stringValue)
    const doubledQuotes = stringValue.replace(/"/g, '""')
    return mustQuote ? `"${doubledQuotes}"` : doubledQuotes
  }

  const rowsAsStrings = (table as unknown[]).map((row) => {
    if (!Array.isArray(row)) {
      return escapeCell(row)
    }
    return row.map((cell) => escapeCell(cell)).join(',')
  })

  const csv = rowsAsStrings.join('\r\n')
  const rowCount = Array.isArray(table) ? (table as any[]).length : 0
  const columnCount =
    Array.isArray(table) && Array.isArray((table as any[])[0]) ? (table as any[])[0].length : 0

  return { csv, rowCount, columnCount }
}
