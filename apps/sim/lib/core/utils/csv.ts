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

const CSV_QUOTE_TRIGGER = /[",\n\r]/
const CSV_LINE_PIECE_CHARS = 256 * 1024

export function toCsvRow(values: string[]): string {
  return values.map(escapeCsvField).join(',')
}

function escapeCsvField(field: string): string {
  return CSV_QUOTE_TRIGGER.test(field) ? `"${field.replace(/"/g, '""')}"` : field
}

/**
 * Yields `toCsvRow(values) + '\n'` as consecutive pieces of about `maxPieceChars` source
 * characters, so a caller can yield to the event loop between pieces instead of escaping a
 * multi-megabyte field in one synchronous run. A piece never ends between the two halves of a
 * surrogate pair, so encoding each piece separately produces the same UTF-8 bytes as encoding the
 * whole line; a lone surrogate stays lone either way. A non-finite size falls back to the default
 * and anything below one becomes one.
 */
export function* toCsvLinePieces(
  values: readonly string[],
  maxPieceChars = CSV_LINE_PIECE_CHARS
): Generator<string> {
  const pieceChars = Number.isFinite(maxPieceChars)
    ? Math.max(1, Math.floor(maxPieceChars))
    : CSV_LINE_PIECE_CHARS
  let pending = ''
  for (let index = 0; index < values.length; index++) {
    if (index > 0) pending += ','
    const field = values[index]
    const quoted = CSV_QUOTE_TRIGGER.test(field)
    if (quoted) pending += '"'
    let start = 0
    while (start < field.length) {
      let end = Math.min(start + pieceChars, field.length)
      if (
        end < field.length &&
        isHighSurrogate(field.charCodeAt(end - 1)) &&
        isLowSurrogate(field.charCodeAt(end))
      ) {
        end += 1
      }
      const slice = field.slice(start, end)
      pending += quoted ? slice.replace(/"/g, '""') : slice
      start = end
      if (pending.length >= pieceChars) {
        yield pending
        pending = ''
      }
    }
    if (quoted) pending += '"'
  }
  yield `${pending}\n`
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}
