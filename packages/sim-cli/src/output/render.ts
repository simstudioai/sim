import chalk from 'chalk'
import type { OutputFormat } from '../config/index.js'

export interface Column<T> {
  header: string
  value: (row: T) => string
}

/** Cell text for values that have no useful rendering, kept visually quiet. */
const EMPTY = chalk.dim('—')

export function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY
  return String(value)
}

/** ISO timestamps are the wire format everywhere; show them without the milliseconds. */
export function timestamp(value: string | null | undefined): string {
  if (!value) return EMPTY
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

export function bool(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return EMPTY
  return value ? chalk.green('yes') : chalk.dim('no')
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return EMPTY
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

/**
 * Matches an ANSI SGR sequence (`ESC [ … m`).
 *
 * Built from a char code rather than written as a literal so the source carries
 * no raw ESC byte — an invisible control character inside a regex literal is the
 * kind of thing an editor, a formatter, or a patch tool silently eats, and the
 * only symptom would be columns drifting by one space per coloured cell.
 */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/**
 * Visible width of a cell, ignoring ANSI colour codes.
 *
 * Padding on the raw string would count the escape sequences as characters and
 * skew every coloured column, so widths are measured on the stripped text while
 * the coloured text is what gets printed.
 */
export function visibleWidth(value: string): number {
  return value.replace(ANSI_PATTERN, '').length
}

function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - visibleWidth(value)))
}

function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  if (rows.length === 0) return chalk.dim('No results.')

  const cells = rows.map((row) => columns.map((column) => column.value(row)))
  const widths = columns.map((column, index) =>
    Math.max(visibleWidth(column.header), ...cells.map((line) => visibleWidth(line[index])))
  )

  const header = columns
    .map((column, index) => chalk.dim(pad(column.header.toUpperCase(), widths[index])))
    .join('  ')
    .trimEnd()

  const body = cells.map((line) =>
    line
      .map((cell, index) => pad(cell, widths[index]))
      .join('  ')
      .trimEnd()
  )

  return [header, ...body].join('\n')
}

/**
 * Prints a list in the profile's output format.
 *
 * The JSON branch prints the raw rows, not the table's formatted cells — piping
 * to `jq` should yield the API's own field names and types, so `--output json`
 * is a passthrough rather than a second rendering.
 */
export function printList<T>(format: OutputFormat, rows: T[], columns: Column<T>[]): void {
  if (format === 'json') {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  console.log(renderTable(rows, columns))
}

/** Prints a single record: JSON as-is, table format as aligned key/value lines. */
export function printRecord(format: OutputFormat, fields: Array<[string, string]>, raw: unknown) {
  if (format === 'json') {
    console.log(JSON.stringify(raw, null, 2))
    return
  }

  const width = Math.max(...fields.map(([label]) => label.length))
  for (const [label, value] of fields) {
    console.log(`${chalk.dim(pad(`${label}:`, width + 1))}  ${value}`)
  }
}
