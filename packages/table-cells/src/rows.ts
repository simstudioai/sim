/**
 * A whole row against its table's columns, with the per-type {@link CELL_RULES}: coercing each cell
 * toward its column's type, checking each cell (and every required one), and finding the rows of a
 * batch that repeat an earlier row's unique value. The server's table writes and the CLI's offline
 * check of a workspace directory's rows both run these, so they agree on every row.
 */
import { canonicalJson } from '@sim/utils/object'
import { cellRuleOf } from './rules'
import type { CellColumn, CellRow, CellValue } from './types'

/** A column's storage key: its id, or its name for a legacy column without one. */
export function cellKeyOf(column: Pick<CellColumn, 'id' | 'name'>): string {
  return column.id ?? column.name
}

/**
 * The cell `row` holds for `key`, read as an own property: a legacy column keyed by its name can
 * be called `constructor`, which a plain index would find on every row's prototype.
 */
export function cellOf(row: CellRow, key: string): CellValue | undefined {
  return Object.hasOwn(row, key) ? row[key] : undefined
}

/** Every error of `data` against `columns`: a missing required cell, or a cell its type refuses. */
export function rowCellErrors(data: CellRow, columns: readonly CellColumn[]): string[] {
  const errors: string[] = []
  for (const column of columns) {
    const value = cellOf(data, cellKeyOf(column))
    if (column.required && (value === undefined || value === null)) {
      errors.push(`Missing required field: ${column.name}`)
      continue
    }
    if (value === null || value === undefined) continue
    const error = cellRuleOf(column).validateCell(value, column)
    if (error !== null) errors.push(error)
  }
  return errors
}

/**
 * What a write does with a value its column's type cannot coerce: `null` blanks the cell (or
 * keeps what `salvage` reads), `reject` leaves the value for {@link rowCellErrors} to report.
 */
export type UncoercibleValuePolicy = 'reject' | 'null'

/**
 * Coerces each present cell of `data` toward its column's type **in place**, handling a value no
 * conversion fits per `policyFor(key)`. A `required` cell is never blanked. Columns absent from
 * `data` are skipped, so it is safe on a partial patch.
 */
export function coerceRowCells(
  data: CellRow,
  columns: readonly CellColumn[],
  policyFor: (key: string) => UncoercibleValuePolicy
): void {
  for (const column of columns) {
    const key = cellKeyOf(column)
    const value = cellOf(data, key)
    if (value === null || value === undefined) continue
    const rule = cellRuleOf(column)
    const coerced = rule.coerce(value, column)
    if (coerced.ok) {
      data[key] = coerced.value
      continue
    }
    if (policyFor(key) !== 'null') continue
    const salvaged = rule.salvage?.(value, column)
    if (salvaged?.ok) {
      data[key] = salvaged.value
    } else if (!column.required) {
      data[key] = null
    }
  }
}

/**
 * The key two unique-column values share when the unique check treats them as equal. Object keys
 * are sorted, since the check compares JSONB, where key order carries no meaning.
 */
export function uniqueValueKey(value: CellValue, column: CellColumn): string {
  return canonicalJson(cellRuleOf(column).valueForEquality?.(value) ?? value)
}

/** The errors of each refused row of a batch, by its index. */
export type BatchRowErrors = Array<{ row: number; errors: string[] }>

/**
 * Scans a batch for values of `uniqueColumns` that an earlier row of the batch already holds,
 * returning those rows' errors and every distinct value per column key (for a database probe).
 */
export function scanBatchUniqueValues<C extends CellColumn>(
  rows: readonly CellRow[],
  uniqueColumns: readonly C[]
): {
  rowErrors: BatchRowErrors
  valuesByColumn: Map<string, { values: Set<string>; column: C }>
} {
  const rowErrors: BatchRowErrors = []
  const firstRows = new Map<string, Map<string, number>>()
  const valuesByColumn = new Map<string, { values: Set<string>; column: C }>()
  for (const column of uniqueColumns) {
    firstRows.set(cellKeyOf(column), new Map())
    valuesByColumn.set(cellKeyOf(column), { values: new Set(), column })
  }
  for (let i = 0; i < rows.length; i++) {
    const currentRowErrors: string[] = []
    for (const column of uniqueColumns) {
      const key = cellKeyOf(column)
      const value = cellOf(rows[i], key)
      const seen = firstRows.get(key)
      if (value === null || value === undefined || !seen) continue
      const normalizedValue = uniqueValueKey(value, column)
      const firstRowIndex = seen.get(normalizedValue)
      if (firstRowIndex !== undefined) {
        currentRowErrors.push(
          `Column "${column.name}" must be unique. Value "${value}" duplicates row ${firstRowIndex + 1} in batch`
        )
      } else {
        seen.set(normalizedValue, i)
        valuesByColumn.get(key)?.values.add(normalizedValue)
      }
    }
    if (currentRowErrors.length > 0) rowErrors.push({ row: i, errors: currentRowErrors })
  }
  return { rowErrors, valuesByColumn }
}

/**
 * The rows a write refuses before it touches a database, checked as the write checks them: each
 * row coerced to its columns' types and select options without blanking a value (`reject`), every
 * required cell filled, and no unique value repeated across the rows. `rows` are coerced in place.
 * `sizeErrors` refuses a row before it is coerced (the server's row size limit).
 */
export function refusedRows(
  rows: CellRow[],
  columns: readonly CellColumn[],
  sizeErrors: (row: CellRow) => string[] = () => []
): BatchRowErrors {
  const errorsByRow = new Map<number, string[]>()
  rows.forEach((row, index) => {
    const tooLarge = sizeErrors(row)
    if (tooLarge.length > 0) {
      errorsByRow.set(index, tooLarge)
      return
    }
    coerceRowCells(row, columns, () => 'reject')
    const errors = rowCellErrors(row, columns)
    if (errors.length > 0) errorsByRow.set(index, errors)
  })
  const unique = columns.filter((column) => column.unique === true)
  for (const { row, errors } of scanBatchUniqueValues(rows, unique).rowErrors) {
    errorsByRow.set(row, [...(errorsByRow.get(row) ?? []), ...errors])
  }
  return [...errorsByRow].sort(([a], [b]) => a - b).map(([row, errors]) => ({ row, errors }))
}
