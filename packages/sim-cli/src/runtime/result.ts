import chalk from 'chalk'
import type { OutputFormat } from '../config/index'
import type { ColumnSpec, CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import {
  bool,
  bytes,
  type Column,
  duration,
  printDocument,
  printList,
  printRecord,
  sanitize,
  text,
  timestamp,
} from '../output/render'
import { printTraceSpans } from '../output/trace'

interface RenderResultOptions {
  expandedTrace?: boolean
}

function countTraceSpans(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.reduce((count, span) => {
    if (!span || typeof span !== 'object' || Array.isArray(span)) {
      throw new Error('Trace contains a malformed span')
    }
    return count + 1 + countTraceSpans((span as Record<string, unknown>).children)
  }, 0)
}

function at(row: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as never)[key] : undefined),
      row
    )
}

/**
 * Undoes the wire encoding of a folder path for the human formats.
 *
 * The inverse of `encodeFolderPath`, per segment for the same reason: `%2F` is
 * a slash inside one folder's name, not a separator. A segment that fails to
 * decode is shown as it arrived rather than dropped — the point is to show the
 * name, and a malformed one is still the truth about what the server holds.
 *
 * A segment whose decoded name contains the separator is shown in wire form for
 * the same reason: decoding it would print a root folder named `a/b` as
 * `/a/b`, byte-identical to a folder `b` nested under `a` — and the printed
 * path is what people paste back, so `folders delete` addressed the other
 * folder. Rendering must not manufacture structure that is not there.
 *
 * Callers must reach this only from a `table` or `text` rendering path — the
 * hand-written `ls` builds its own columns and so decodes through here directly.
 * `json` and `yaml` render from the raw payload so that switching format never
 * changes the data, and a script piping a path back needs the wire form.
 */
export function decodeFolderPath(value: string): string {
  return value
    .split('/')
    .map((segment) => {
      try {
        const decoded = decodeURIComponent(segment)
        return decoded.includes('/') ? segment : decoded
      } catch {
        return segment
      }
    })
    .join('/')
}

function renderCell(
  value: unknown,
  format: ColumnSpec['format'],
  options: RenderResultOptions = {}
): string {
  switch (format) {
    case 'timestamp':
      return timestamp(value as string | null)
    case 'bytes':
      return bytes(value as number | null)
    case 'duration':
      return duration(value as number | null)
    case 'bool':
      return bool(value as boolean | null)
    case 'cost':
      return typeof value === 'number' ? `$${value.toFixed(4)}` : text(null)
    case 'score':
      return typeof value === 'number' ? value.toFixed(4) : text(null)
    case 'count':
      return Array.isArray(value) ? String(value.length) : text(null)
    case 'folder-path':
      return typeof value === 'string' ? text(decodeFolderPath(value)) : text(value)
    case 'trace-count': {
      const count = countTraceSpans(value)
      return `${count} ${count === 1 ? 'span' : 'spans'}${
        options.expandedTrace ? '' : ' (use --trace)'
      }`
    }
    default:
      if (value === null || value === undefined || value === '') return text(null)
      return sanitize(typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
}

/** ISO timestamps: `createdAt`, `updatedAt`, `expiresAt`, `startDate`. */
const TIMESTAMP_KEY = /(?:At|Date)$/
/** Millisecond durations: `durationMs`, `totalDurationMs`, `duration`. */
const DURATION_KEY = /Ms$|^duration/
/** Byte counts: `size`, `fileSize`, `usageBytes`. */
const BYTES_KEY = /^size$|(?:Size|Bytes)$/
/** Yes/no facts: `isActive`, `hasServiceAccountKey`. */
const BOOL_KEY = /^(?:is|has)[A-Z]/
/** Relevance scores in 0–1: `similarity`, `score`, `matchScore`. */
const RATIO_KEY = /^(?:similarity|score)$|(?:Similarity|Score)$/
/**
 * Wire-encoded folder paths, the only `*Path` keys the v2 responses carry.
 *
 * The folder create, move and delete operations declare no columns, so their
 * echo of the path fell through to the raw wire form — `sim tables folders
 * create 'Reports/Q1 2026'` answered `/Reports/Q1%202026` and the `ls` right
 * after it showed the same folder decoded.
 */
const FOLDER_PATH_KEY = /^(?:path|parentPath|folderPath)$/

/** Enough of an ISO stamp to be sure a string is one before parsing it as a date. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

/** Decimals kept for a ratio; `0.2818676545790171` is noise past the fourth. */
const RATIO_PRECISION = 4

/**
 * Picks a renderer for a value the contract says nothing about, from the shape
 * of its key.
 *
 * Most operations declare no `columns`/`fields`, so their output fell through to
 * `String(value)` and printed raw ISO stamps, raw byte counts and raw float
 * milliseconds next to sibling commands that format all three. The runtime type
 * has to agree with the key before anything is inferred — a `size` that is a
 * string is not a byte count, a `deletedAt` of `null` is not a date — so a
 * mismatch falls back to the plain stringification rather than to `NaN`.
 *
 * Only ever asked about a key the API itself named. A key shape is a promise
 * about the value, and only the contract's own field names carry one.
 */
function inferFormat(key: string, value: unknown): ColumnSpec['format'] | null {
  if (typeof value === 'boolean') return BOOL_KEY.test(key) ? 'bool' : null
  if (typeof value === 'string') {
    if (FOLDER_PATH_KEY.test(key)) return 'folder-path'
    return TIMESTAMP_KEY.test(key) && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
      ? 'timestamp'
      : null
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (DURATION_KEY.test(key)) return 'duration'
  if (BYTES_KEY.test(key)) return 'bytes'
  return null
}

function inferredCell(key: string, value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && RATIO_KEY.test(key)) {
    return value.toFixed(RATIO_PRECISION)
  }
  return renderCell(value, inferFormat(key, value) ?? 'auto')
}

/** `latestOperationStatus` → `latest operation status`, `row_count` → `row count`. */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Header for an inferred column or field.
 *
 * The raw key reached the terminal as `DISPLAYNAME` and `LATESTOPERATIONSTATUS`
 * once the table upper-cased it. A unit suffix goes too when the value's
 * formatter already prints the unit (`durationMs` heading a `9ms`), and so does
 * the `is` of a boolean, which the yes/no value makes redundant. `has` stays:
 * `has key` says something that `key` alone does not.
 */
function inferHeader(key: string, format: ColumnSpec['format'] | null): string {
  const trimmed =
    format === 'duration' || format === 'bytes'
      ? key.replace(/(?:Ms|Bytes)$/, '')
      : format === 'bool'
        ? key.replace(/^is(?=[A-Z])/, '')
        : key
  return humanizeKey(trimmed || key)
}

function columnsFrom(specs: ColumnSpec[]): Column<unknown>[] {
  return specs.map((spec) => ({
    header: spec.header,
    value: (row: unknown) => renderCell(at(row, spec.path ?? spec.header), spec.format),
  }))
}

function fieldsFrom(
  data: unknown,
  specs: ColumnSpec[],
  options: RenderResultOptions = {}
): Array<[string, string]> {
  return specs.map<[string, string]>((spec) => {
    const value = at(data, spec.path ?? spec.header)
    // A declared field is editorial: someone decided this record is not fully
    // described without it. Dropping it when the API stops returning it made
    // `billing status` print no credits at all and say nothing about it, so an
    // absent field shows the same glyph a null one does.
    return [spec.header, value === undefined ? text(null) : renderCell(value, spec.format, options)]
  })
}

/**
 * Builds columns for a list the contract declares none for.
 *
 * A row's own keys are the API's, so their shape may be read as a promise about
 * the value. The keys inside `expand` are not: `tables rows list` and `tables
 * rows query` expand `data`, whose keys are the column names the *user* chose.
 * Inferring there renamed their columns (`isBillable` heading as `BILLABLE`,
 * which is no longer the string `--filter` wants back) and reformatted their
 * values (a `score` of 3 as `3.0000`, a `size` of 5 as `5 B`). So an expanded
 * cell keeps its literal key and its plain stringification.
 */
function inferColumns(rows: unknown[], expand?: string): Column<unknown>[] {
  const paths: Array<{ path: string; key: string; header: string; owned: boolean }> = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const [key, value] of Object.entries(row)) {
      if (seen.has(key)) continue
      if (value !== null && typeof value === 'object') continue
      seen.add(key)
      paths.push({ path: key, key, header: inferHeader(key, inferFormat(key, value)), owned: true })
    }
  }

  if (expand) {
    const nested = new Set<string>()
    for (const row of rows) {
      const container = at(row, expand)
      if (!container || typeof container !== 'object' || Array.isArray(container)) continue
      for (const key of Object.keys(container)) {
        if (nested.has(key)) continue
        nested.add(key)
        // The header keeps the container prefix only where the bare key would
        // collide with one of the row's own columns.
        paths.push({
          path: `${expand}.${key}`,
          key,
          header: seen.has(key) ? `${expand}.${key}` : key,
          owned: false,
        })
      }
    }
  }

  return paths.map(({ path, key, header, owned }) => ({
    header: sanitize(header),
    // The format is re-inferred per row: the first row decided the header, but a
    // later row may hold a different type under the same key.
    value: (row: unknown) =>
      owned ? inferredCell(key, at(row, path)) : renderCell(at(row, path), 'auto'),
  }))
}

function unwrapResource(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const entries = Object.entries(data)
  if (entries.length !== 1) return data
  const [, value] = entries[0]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : data
}

export function renderPage(
  format: OutputFormat,
  rows: unknown[],
  spec: CommandSpec,
  envelope?: unknown,
  options: { truncated?: boolean } = {}
): void {
  writePageNote(spec, envelope)
  writeEnvelopeTruncation(envelope)
  writeCursorTruncation(rows.length, options.truncated === true)
  printList(
    format,
    rows,
    spec.columns ? columnsFrom(spec.columns) : inferColumns(rows, spec.expand)
  )
}

/**
 * States a page-envelope fact once, above the rows, on stderr.
 *
 * stdout is the rows and stays byte-for-byte what it was: `--output text` is
 * positional and tab-separated, and a script cutting fields from it must not
 * have to skip a header it did not ask for. Every format gets the note, the
 * machine ones included — a paginated command walks the pages itself and prints
 * the accumulated rows, so the envelope reaches no output format on stdout.
 */
function writePageNote(spec: CommandSpec, envelope: unknown): void {
  if (!spec.pageNote) return
  const value = at(envelope, spec.pageNote.path)
  if (value === undefined || value === null) return
  process.stderr.write(chalk.dim(`${spec.pageNote.label}: ${String(value)}\n`))
}

/**
 * Envelope fields that state the server itself clipped the list.
 *
 * Matched by shape rather than listed per command, so a flag added to a route
 * envelope is surfaced the day it lands: the CLI accumulates the rows and
 * prints those, so an envelope field reaches no output format on its own.
 */
const TRUNCATION_FLAG = /^truncated$|Truncated$/

/** The envelope flags a page raised, in the spelling the wire used. */
function truncationFlags(envelope: unknown): string[] {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return []
  return Object.entries(envelope)
    .filter(([key, value]) => value === true && TRUNCATION_FLAG.test(key))
    .map(([key]) => key)
}

/**
 * Carries a truncation stated on any page, not only the first.
 *
 * The envelope is otherwise the first page's, because a fact about the whole
 * query (billing's `scope`) is stated once — but `toolNamesTruncated` is
 * computed per page, so a walk that clipped on page 7 would have said nothing.
 */
export function foldPageEnvelope(current: unknown, page: unknown): unknown {
  if (current === undefined) return page
  const raised = truncationFlags(page)
  if (raised.length === 0 || !current || typeof current !== 'object') return current
  return {
    ...(current as Record<string, unknown>),
    ...Object.fromEntries(raised.map((flag) => [flag, true])),
  }
}

/** `toolNamesTruncated` as a reader says it. */
function spellOut(flag: string): string {
  return flag
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
}

/**
 * States a server-side clip once, on stderr, in every format.
 *
 * The API answers a clipped inventory with a flag on the envelope, and the CLI
 * printed only `data` — so `--output json` could not tell a complete list from
 * one the server cut short. stdout stays byte-for-byte the rows, for the reason
 * `writePageNote` gives.
 */
function writeEnvelopeTruncation(envelope: unknown): void {
  for (const flag of truncationFlags(envelope)) {
    process.stderr.write(
      chalk.dim(`${spellOut(flag)}: the server clipped this list, so it is incomplete\n`)
    )
  }
}

/**
 * States that the walk stopped at `--limit` while more pages remained.
 *
 * `sim tools list` answered 100 of 4708 rows with an exit code of 0 and nothing
 * on stderr, in every format — indistinguishable from a complete inventory.
 * Said whenever a cursor survives, including when the caller set a small limit:
 * the answer is incomplete either way, and the caller who capped it is the one
 * most likely to reuse the result as if it were whole.
 */
function writeCursorTruncation(count: number, truncated: boolean): void {
  if (!truncated) return
  process.stderr.write(
    chalk.dim(`showing the first ${count}; more results exist — re-run with --limit 0 for all\n`)
  )
}

/** Renders one non-paginated operation result according to its CLI contract. */
export function renderResult(
  operation: V2OperationName,
  format: OutputFormat,
  raw: unknown,
  spec: CommandSpec,
  options: RenderResultOptions = {},
  envelope?: unknown
): void {
  // Before any branch: the flag lives on the envelope `execute` unwraps one
  // line before rendering, and states a fact about the payload below it.
  writeEnvelopeTruncation(envelope)

  if (spec.document) {
    printDocument(format, raw)
    return
  }

  const data = unwrapResource(raw)
  if (spec.itemsPath) {
    const items = at(data, spec.itemsPath)
    if (!Array.isArray(items)) {
      throw new Error(`${operation} expected an array at response path ${spec.itemsPath}`)
    }
    printList(
      format,
      items,
      spec.columns ? columnsFrom(spec.columns) : inferColumns(items, spec.expand),
      data
    )
    return
  }

  if (Array.isArray(data)) {
    printList(
      format,
      data,
      spec.columns ? columnsFrom(spec.columns) : inferColumns(data, spec.expand)
    )
    return
  }

  const fields = spec.fields
    ? fieldsFrom(data, spec.fields, options)
    : data && typeof data === 'object'
      ? Object.entries(data).map<[string, string]>(([key, value]) => [
          inferHeader(key, inferFormat(key, value)),
          inferredCell(key, value),
        ])
      : []

  printRecord(format, fields, data)
  if (spec.expandedTrace && options.expandedTrace) {
    const traceSpans = at(data, 'traceSpans')
    if (!Array.isArray(traceSpans)) {
      throw new Error(`${operation} expected a traceSpans array`)
    }
    printTraceSpans(format, traceSpans)
  }
}
