import type { CellAddress, CellObject, Range, WorkSheet } from 'xlsx'

/**
 * Read options that make a workbook's cells carry the text a user sees in
 * Excel rather than the values Excel stores.
 *
 * `cellDates` parses date serials into `Date` objects whose UTC fields are the
 * calendar fields, independent of the process time zone. `cellNF` keeps each
 * cell's number format so General-formatted numbers can be told apart from
 * currency, percent and date cells.
 */
export const SHEET_DISPLAY_READ_OPTIONS = {
  cellDates: true,
  cellNF: true,
} as const

interface CellLookup {
  encode_cell: (address: CellAddress) => string
}

/** Excel shows 15 significant digits for a General-formatted number. */
const GENERAL_SIGNIFICANT_DIGITS = 15

const ELAPSED_TOKEN = /\[(h+|m+|s+)\]/i

/**
 * Strips the parts of a number format that carry no date tokens: quoted
 * literals, backslash escapes, bracketed colour/condition/elapsed sections and
 * the AM/PM markers whose `m` is not a month.
 */
function dateTokensOf(format: string): string {
  return format
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/am\/pm|a\/p/gi, '')
    .toLowerCase()
}

/**
 * Whether a date format shows a time of day and nothing else, such as
 * `h:mm:ss` or `hh:mm AM/PM`. Any `y` or `d` token is a date, and so is an `m`
 * run that is not next to hours or seconds, which is how Excel tells a month
 * from minutes.
 */
export function isTimeOnlyFormat(format: string): boolean {
  const tokens = dateTokensOf(format)
  if (/[yd]/.test(tokens)) return false
  if (!/[hms]/.test(tokens)) return false
  for (const match of tokens.matchAll(/m+/g)) {
    const before = tokens.slice(0, match.index).replace(/[:\s]+$/, '')
    const after = tokens.slice(match.index + match[0].length).replace(/^[:\s]+/, '')
    const isMinutes = before.endsWith('h') || after.startsWith('s')
    if (!isMinutes) return false
  }
  return true
}

const MS_PER_SECOND = 1000

/**
 * Excel dates carry no zone. Emit the UTC fields SheetJS parsed the serial
 * into, without a trailing `Z`, and drop the time when it is midnight.
 *
 * A float serial such as `45366.572916666664` parses to `13:44:59.999`, so
 * the instant is rounded to the nearest second first; a value that rounds up
 * to midnight is a whole date.
 *
 * A time-of-day cell is decided from its format, because the epoch date its
 * serial lands on differs between 1900 and 1904 workbooks. Without a format,
 * a date before 1900 can only be a fraction of a day and is shown as a time.
 */
export function isoDateText(parsed: Date, format?: string): string {
  if (Number.isNaN(parsed.getTime())) return ''
  const date = new Date(Math.round(parsed.getTime() / MS_PER_SECOND) * MS_PER_SECOND)
  const iso = date.toISOString()
  const timeOnly = format === undefined ? date.getUTCFullYear() < 1900 : isTimeOnlyFormat(format)
  if (timeOnly) return iso.slice(11, 19)
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19)
}

/**
 * Renders a General-formatted number the way Excel displays it: integers in
 * full, so 16-digit identifiers keep every digit, and fractions rounded to 15
 * significant digits, so `=0.1+0.2` reads `0.3`.
 */
export function generalNumberText(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(GENERAL_SIGNIFICANT_DIGITS)))
}

function isGeneralFormat(format: unknown): boolean {
  return format === undefined || format === 'General'
}

/**
 * Rewrites the display text of the cells that `sheet_to_json({ raw: false })`
 * would otherwise render badly, within the bounded window only.
 *
 * `raw: false` returns `cell.w` verbatim. The file's `w` is right for currency,
 * percent, boolean and text cells, but not for dates (locale-shaped, such as
 * `3/4/2026`) or General-formatted numbers (Excel's 11-character rendering
 * turns `4111111111111111` into `4.11111E+15`, losing digits of numeric IDs).
 * Dates become ISO text and General numbers print as Excel displays them.
 *
 * Elapsed-time formats (`[h]:mm`, `[mm]:ss`) are durations, not moments;
 * `cellDates` still parses them into a `Date`, so their `w` (`30:00`) is kept.
 *
 * A number with no format at all is treated as General too. Every other
 * number keeps the text the file rendered for it, so a LibreOffice workbook
 * indexes as LibreOffice showed it (`0,5` in a German locale).
 *
 * Works on dense (`!data`) and sparse (address-keyed) worksheets so the same
 * pass serves the indexing parser and the Files viewer.
 */
export function normalizeSheetDisplayText(
  worksheet: WorkSheet,
  window: Range,
  utils: CellLookup
): void {
  const data = worksheet['!data']
  const lastRow = data ? Math.min(window.e.r, data.length - 1) : window.e.r

  for (let r = window.s.r; r <= lastRow; r++) {
    const denseRow = data?.[r]
    if (data && !denseRow) continue

    for (let c = window.s.c; c <= window.e.c; c++) {
      const cell: CellObject | undefined = denseRow
        ? denseRow[c]
        : (worksheet[utils.encode_cell({ r, c })] as CellObject | undefined)
      if (!cell) continue

      if (cell.t === 'd' && cell.v instanceof Date) {
        const format = typeof cell.z === 'string' ? cell.z : undefined
        if (format !== undefined && ELAPSED_TOKEN.test(format)) continue
        cell.w = isoDateText(cell.v, format)
      } else if (cell.t === 'n' && typeof cell.v === 'number' && isGeneralFormat(cell.z)) {
        cell.w = generalNumberText(cell.v)
      }
    }
  }
}
