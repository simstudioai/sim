/**
 * Client-side row filtering for Google Sheets read results.
 *
 * The Google Sheets REST API (`spreadsheets.values.get`) has no server-side
 * content filtering — `DataFilter` selects only by A1 range, grid range, or
 * developer metadata, never by cell value. Filtering by cell content must
 * therefore happen after values are fetched, over the window of rows the read
 * returned (e.g. the default `A1:Z1000`), not the entire sheet.
 */

/**
 * Supported ways to compare a cell against the filter value. Text operators are
 * case-insensitive. The ordering operators (`gt`/`gte`/`lt`/`lte`) compare
 * numerically when both operands parse as finite numbers, fall back to
 * case-insensitive lexicographic comparison when both are non-numeric (which
 * orders ISO dates correctly), and never match when one side is numeric and the
 * other is not (the values are not comparable).
 */
export type SheetFilterMatchType =
  | 'contains'
  | 'not_contains'
  | 'exact'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export interface SheetFilterOptions {
  filterColumn?: string
  filterValue?: string
  filterMatchType?: SheetFilterMatchType
}

export interface SheetFilterResult {
  /** The (possibly filtered) values, always including the header row when present. */
  values: unknown[][]
  /** Whether row filtering was actually applied to the data rows. */
  applied: boolean
  /** Whether the requested filter column was found in the header row. */
  columnFound: boolean
  /** Number of data rows (excluding the header) that matched the filter. */
  matchedRows: number
  /** Total number of data rows (excluding the header) that were considered. */
  totalRows: number
}

const DEFAULT_MATCH_TYPE: SheetFilterMatchType = 'contains'

/**
 * Parses a cell string as a finite number, or returns null when it is blank or
 * non-numeric so callers can fall back to lexicographic comparison.
 */
function asFiniteNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Case-insensitive lexicographic comparison returning -1, 0, or 1. */
function compareLexicographic(cell: string, target: string): number {
  return Math.sign(cell.toLowerCase().localeCompare(target.toLowerCase()))
}

/** Evaluates a single cell against the filter target for the given match type. */
function matchesCell(cell: string, target: string, matchType: SheetFilterMatchType): boolean {
  switch (matchType) {
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cellNum = asFiniteNumber(cell)
      const targetNum = asFiniteNumber(target)
      let cmp: number
      if (cellNum !== null && targetNum !== null) {
        cmp = Math.sign(cellNum - targetNum)
      } else if (cellNum === null && targetNum === null) {
        cmp = compareLexicographic(cell, target)
      } else {
        return false
      }
      if (matchType === 'gt') return cmp > 0
      if (matchType === 'gte') return cmp >= 0
      if (matchType === 'lt') return cmp < 0
      return cmp <= 0
    }
    case 'exact':
      return cell.toLowerCase() === target.toLowerCase()
    case 'not_equals':
      return cell.toLowerCase() !== target.toLowerCase()
    case 'starts_with':
      return cell.toLowerCase().startsWith(target.toLowerCase())
    case 'ends_with':
      return cell.toLowerCase().endsWith(target.toLowerCase())
    case 'not_contains':
      return !cell.toLowerCase().includes(target.toLowerCase())
    default:
      return cell.toLowerCase().includes(target.toLowerCase())
  }
}

/**
 * Filters a 2D values array (header row + data rows) by matching a single column
 * against a target value. Returns the original values untouched when no filter
 * is requested, when there are no data rows, or when the column is not found —
 * the `applied`/`columnFound` flags let callers distinguish "no match possible"
 * from "everything matched".
 */
export function filterSheetRows(
  values: unknown[][],
  options: SheetFilterOptions
): SheetFilterResult {
  const { filterColumn, filterValue, filterMatchType } = options
  const totalRows = Math.max(values.length - 1, 0)

  if (!filterColumn || filterValue === undefined || filterValue === '') {
    return { values, applied: false, columnFound: true, matchedRows: totalRows, totalRows }
  }

  const headers = values[0] ?? []
  const normalizedColumn = filterColumn.trim().toLowerCase()
  const columnIndex = headers.findIndex(
    (header) => String(header).trim().toLowerCase() === normalizedColumn
  )
  const columnFound = columnIndex !== -1

  // No data rows to evaluate (empty or header-only sheet): nothing matched, but
  // still report whether the requested column actually exists in the header.
  if (values.length <= 1) {
    return { values, applied: false, columnFound, matchedRows: 0, totalRows: 0 }
  }

  // Column not found: leave rows untouched and report zero matches, not totalRows.
  if (!columnFound) {
    return { values, applied: false, columnFound: false, matchedRows: 0, totalRows }
  }

  const matchType = filterMatchType ?? DEFAULT_MATCH_TYPE
  const matched = values
    .slice(1)
    .filter((row) => matchesCell(String(row[columnIndex] ?? ''), filterValue, matchType))

  return {
    values: [values[0], ...matched],
    applied: true,
    columnFound: true,
    matchedRows: matched.length,
    totalRows,
  }
}
