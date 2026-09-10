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

/**
 * Excel dates carry no zone. Emit the UTC fields SheetJS parsed the serial
 * into, without a trailing `Z`, and drop the time when it is midnight.
 */
export function isoDateText(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const iso = date.toISOString()
  /** A serial below 1 is a duration or time of day; Excel shows it without the 1899 epoch date. */
  if (date.getUTCFullYear() < 1900) return iso.slice(11, 19)
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19)
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
 * Dates become ISO text and General numbers print their full stored value.
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
        cell.w = isoDateText(cell.v)
      } else if (cell.t === 'n' && typeof cell.v === 'number' && isGeneralFormat(cell.z)) {
        cell.w = String(cell.v)
      }
    }
  }
}
