import chalk from 'chalk'
import { dump } from 'js-yaml'
import type { OutputFormat } from '../config/index'
import { displayWidth } from './terminal-text'

export interface Column<T> {
  header: string
  value: (row: T) => string
}

/** The glyph standing in for "no value", before colour is applied. */
const EMPTY_GLYPH = '—'

/** Cell text for values that have no useful rendering, kept visually quiet. */
const EMPTY = chalk.dim(EMPTY_GLYPH)

/**
 * Escape sequences and control characters that must never reach a terminal
 * from server-supplied data.
 *
 * Covers CSI (`ESC [ … final`), OSC (`ESC ] … BEL|ST`), single-character escapes
 * such as `ESC c` (full reset), and the bare C0/C1 control range. Anything a
 * knowledge document, table cell, or workflow name contains is remote content —
 * a document could set the window title, move the cursor to overwrite what was
 * already printed, reset the terminal, or on some emulators drive clipboard and
 * paste controls.
 *
 * Matching only SGR (`… m`) was the hole: it stripped colour and left every
 * other sequence executable.
 */
const ESC = String.fromCharCode(27)
const CONTROL_PATTERN = new RegExp(
  [
    `${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?`, // OSC … BEL or ST
    `${ESC}\\[[0-9;?]*[ -/]*[@-~]`, // CSI … final byte
    // Any other ESC + printable: `ESC c` (full reset), `ESC 7`/`ESC 8` (cursor
    // save/restore), `ESC (0` (line-drawing charset), and the rest. ESC is never
    // legitimate content, so the whole two-byte form goes. OSC and CSI are
    // matched above, so they win at the same position.
    `${ESC}[ -~]`,
    `${ESC}`, // a lone ESC with nothing valid after it
    '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]', // C0/C1; CR is normalized below
  ].join('|'),
  'g'
)

// Directional formatting marks can visually reorder an otherwise safe label
// or URL without changing its underlying bytes. Remove only the explicit
// controls; ordinary Hebrew, Arabic, and other right-to-left text is preserved.
const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu

/**
 * Removes terminal control sequences from a server-supplied string.
 *
 * Applied where API values become display text, so the colour the CLI adds
 * afterwards still works — sanitizing the finished cell would strip our own
 * formatting too.
 */
export function sanitize(value: string): string {
  // Preserve normal Windows line endings without leaving a lone carriage
  // return capable of moving the cursor back over already-rendered text.
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(CONTROL_PATTERN, '')
    .replace(BIDI_CONTROL_PATTERN, '')
}

/** Flattens untrusted terminal text into one compact, display-safe line. */
export function safeOneLine(value: string): string {
  return sanitize(value)
    .replace(/[\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY
  return sanitize(String(value))
}

/** ISO timestamps are the wire format everywhere; show them without the milliseconds. */
export function timestamp(value: string | null | undefined): string {
  if (!value) return EMPTY
  const date = new Date(value)
  // Sanitized on the way out: an unparseable value is echoed verbatim, and it is
  // still server-supplied, so this branch was a way to smuggle control sequences
  // past every other formatter.
  if (Number.isNaN(date.getTime())) return sanitize(String(value))
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
  // The API measures runs with a high-resolution clock, so a duration arrives as
  // `9.145596999907866`. Sub-millisecond precision is noise in a terminal and
  // the raw float is wider than every other cell in the row.
  if (ms < 1000) return `${Math.round(ms)}ms`
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
/**
 * Visible width of a cell.
 *
 * Delegates to the grapheme-aware measurement: the previous implementation
 * counted stripped string length, so emoji and East Asian characters measured
 * as one column and mis-aligned every table containing them.
 */
export function visibleWidth(value: string): number {
  return displayWidth(value)
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

/**
 * Flattens a cell onto one line.
 *
 * `sanitize` keeps `\t` and `\n` on purpose — they are legitimate content, and
 * json/yaml must round-trip them. Every *display* format is line-oriented
 * though: one newline inside a table cell pushes the rest of the row into the
 * next line and every column after it loses its alignment, and in `text` mode a
 * stray tab invents a field that `cut -f` then reads as real. A table row of a
 * workflow's Slack output did exactly this.
 *
 * Applied to finished cells only, so it cannot reach the machine formats.
 */
function oneLine(value: string): string {
  return value.replace(/\s*[\r\n\t]+\s*/g, ' ')
}

/**
 * Widest a single table column may render.
 *
 * A table row can hold a whole LLM response; at full width one such cell sets
 * the column width for every row and pushes everything after it off-screen.
 * `text`, `json` and `yaml` are untouched — this is a legibility cap on the
 * human view, and the other three formats exist for the whole value.
 */
const MAX_CELL_WIDTH = 60

/**
 * Widest a single record field may render in `table` mode.
 *
 * A record prints one value per line, so a long value costs nothing but its own
 * line — far more room than a table column, where one wide cell sets the width
 * for every row. The clamp lives in `printRecord` rather than in the caller that
 * builds the fields, so `text`, `json` and `yaml` still carry the whole value:
 * clamping before the format branch truncated commands whose entire output is
 * one signed URL, silently, in the format built for pipes.
 */
const MAX_RECORD_WIDTH = 160

function clamp(value: string, width: number): string {
  // ANSI-bearing cells come from the short formatters (`yes`/`no`, the empty
  // glyph); slicing one mid-escape would corrupt it, and none are ever wide.
  if (visibleWidth(value) <= width || value !== value.replace(ANSI_PATTERN, '')) {
    return value
  }
  return `${value.slice(0, width - 1)}…`
}

function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  if (rows.length === 0) return chalk.dim('No results.')

  // A header can be a user-defined column name (a table's own columns), so it is
  // remote content and gets the same treatment as a cell. Doing it here rather
  // than only at each call site means a future column source cannot reopen this.
  const headers = columns.map((column) => sanitize(column.header))
  const cells = rows.map((row) =>
    columns.map((column) => clamp(oneLine(column.value(row)), MAX_CELL_WIDTH))
  )
  const widths = columns.map((_column, index) =>
    Math.max(visibleWidth(headers[index]), ...cells.map((line) => visibleWidth(line[index])))
  )

  const header = headers
    .map((label, index) => chalk.dim(pad(label.toUpperCase(), widths[index])))
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
export function printList<T>(
  format: OutputFormat,
  rows: T[],
  columns: Column<T>[],
  raw: unknown = rows
): void {
  const machine = renderMachine(format, raw)
  if (machine !== null) {
    console.log(machine)
    return
  }

  if (format === 'text') {
    for (const row of rows) {
      console.log(columns.map((column) => oneLine(stripAnsi(column.value(row)))).join('\t'))
    }
    return
  }

  console.log(renderTable(rows, columns))
}

/**
 * Prints a payload whose value IS the deliverable — `workflows export`, which
 * is meant to be redirected to a file and fed back to `import`.
 *
 * `table` and `text` are display formats: they flatten, truncate and colour, so
 * neither can round-trip a document. Rather than emit something that looks like
 * an export but cannot be re-imported, those two fall back to JSON. Only `yaml`
 * is honoured, because it round-trips.
 */
export function printDocument(format: OutputFormat, raw: unknown): void {
  console.log(
    format === 'yaml' ? (renderMachine('yaml', raw) as string) : JSON.stringify(raw, null, 2)
  )
}

/**
 * Prints a single record: machine formats from the raw value, otherwise aligned
 * lines. As in `printList`, only the `table` rendering is clamped.
 */
export function printRecord(format: OutputFormat, fields: Array<[string, string]>, raw: unknown) {
  const machine = renderMachine(format, raw)
  if (machine !== null) {
    console.log(machine)
    return
  }

  const safeFields = fields.map<[string, string]>(([label, value]) => [safeOneLine(label), value])

  if (format === 'text') {
    for (const [label, value] of safeFields) {
      console.log(`${label}\t${oneLine(stripAnsi(value))}`)
    }
    return
  }

  const width = Math.max(...safeFields.map(([label]) => visibleWidth(label)))
  for (const [label, value] of safeFields) {
    console.log(
      `${chalk.dim(pad(`${label}:`, width + 1))}  ${clamp(oneLine(value), MAX_RECORD_WIDTH)}`
    )
  }
}
