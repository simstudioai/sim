import chalk from 'chalk'
import { dump } from 'js-yaml'
import type { OutputFormat } from '../config/index.js'

export interface Column<T> {
  header: string
  value: (row: T) => string
}

/** The glyph standing in for "no value", before colour is applied. */
const EMPTY_GLYPH = '—'

/** Cell text for values that have no useful rendering, kept visually quiet. */
const EMPTY = chalk.dim(EMPTY_GLYPH)

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

/**
 * Plain text for a rendered cell.
 *
 * The empty placeholder collapses to an actual empty field: `cut -f3` returning
 * a literal `—` for a null would be worse than useless, since every downstream
 * emptiness test would read it as a value.
 */
function stripAnsi(value: string): string {
  const plain = value.replace(ANSI_PATTERN, '')
  return plain === EMPTY_GLYPH ? '' : plain
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
 * Renders the machine-readable formats from the RAW value.
 *
 * Deliberately not the table's formatted cells: `--output json` piped into `jq`
 * must yield the API's own field names and types, so a `1500` stays a number
 * rather than becoming the `"1.5s"` the table would show. `yaml` follows the
 * same rule, so switching format never changes the data.
 *
 * Returns null when the format wants the human rendering instead.
 */
function renderMachine(format: OutputFormat, raw: unknown): string | null {
  if (format === 'json') return JSON.stringify(raw, null, 2)
  // `lineWidth: 0` disables YAML's line folding — a wrapped value is technically
  // valid but is miserable to eyeball and breaks naive line-oriented greps.
  if (format === 'yaml') return dump(raw, { lineWidth: 0, noRefs: true }).trimEnd()
  return null
}

/**
 * Prints a list in the profile's output format.
 *
 * `text` emits the table's cells tab-separated with no header and no colour —
 * the shape `cut -f2` and `while read` expect. It uses the formatted cells
 * rather than the raw values on purpose: it is a human-ish format for shell
 * plumbing, and a raw ISO timestamp or byte count is worse in that context.
 */
export function printList<T>(format: OutputFormat, rows: T[], columns: Column<T>[]): void {
  const machine = renderMachine(format, rows)
  if (machine !== null) {
    console.log(machine)
    return
  }

  if (format === 'text') {
    for (const row of rows) {
      console.log(columns.map((column) => stripAnsi(column.value(row))).join('\t'))
    }
    return
  }

  console.log(renderTable(rows, columns))
}

/** Prints a single record: machine formats from the raw value, otherwise aligned lines. */
export function printRecord(format: OutputFormat, fields: Array<[string, string]>, raw: unknown) {
  const machine = renderMachine(format, raw)
  if (machine !== null) {
    console.log(machine)
    return
  }

  if (format === 'text') {
    for (const [label, value] of fields) {
      console.log(`${label}\t${stripAnsi(value)}`)
    }
    return
  }

  const width = Math.max(...fields.map(([label]) => label.length))
  for (const [label, value] of fields) {
    console.log(`${chalk.dim(pad(`${label}:`, width + 1))}  ${value}`)
  }
}
