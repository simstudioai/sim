import chalk from 'chalk'
import { type Command, Option } from 'commander'
import { dump } from 'js-yaml'
import type { OutputFormat } from '../../config/index'
import { clientFrom } from '../../context'
import { CLI_CONTRACT } from '../../contract/commands'
import type { ColumnSpec } from '../../contract/types'
import { type ListLogsResponse, V2_OPERATIONS } from '../../generated/v2-api'
import { sleep } from '../../helpers'
import { SimApiError, type SimClient } from '../../http/client'
import {
  bool,
  bytes,
  type Column,
  duration,
  printList,
  text,
  timestamp,
  visibleWidth,
} from '../../output/render'
import { encodeFolderPath } from '../../runtime/request'

/** One run, as `GET /api/v2/logs` returns it. */
export type LogRow = ListLogsResponse['data'][number]

/** Recent runs printed before the follow starts watching, as `tail -f` does. */
const DEFAULT_BACKLOG = 10

/** Seconds between polls when `--interval` is not given. */
const DEFAULT_INTERVAL_SECONDS = 3

/**
 * Shortest poll interval accepted.
 *
 * A follow is an unattended loop against a rate-limited API, so the floor is
 * what stops a typo — `--interval 0.001` — from turning one terminal into a
 * request flood the workspace is billed for.
 */
const MIN_INTERVAL_SECONDS = 0.1

/** Longest a backoff may stretch the poll interval while the API is unhappy. */
const MAX_BACKOFF_MS = 30_000

/** Rows asked for per page once the follow is watching. */
const POLL_PAGE_SIZE = 100

/**
 * Pages one poll walks back before it stops catching up.
 *
 * A burst larger than this is not lost — the next poll resumes from the same
 * high-water mark — but it bounds how long a single poll can hold the loop.
 */
const MAX_PAGES_PER_POLL = 10

/**
 * Run ids the follow remembers.
 *
 * The set is what makes a run print exactly once, so it has to be bounded for a
 * follow left running for days. Eviction also raises the floor, so an id that is
 * forgotten cannot come back as a new row.
 */
const MAX_REMEMBERED_RUNS = 5000

/** Widest a table column renders, matching the `logs list` table. */
export const MAX_CELL_WIDTH = 60

/** How often an interruptible wait checks whether Ctrl-C has arrived. */
const WAIT_SLICE_MS = 250

/**
 * Client statuses worth retrying.
 *
 * Every other 4xx describes the request itself — a rejected filter, a key that
 * cannot read this workspace — and retrying one every few seconds repeats the
 * same rejection forever instead of showing it once and stopping.
 */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429])

/**
 * Erases from the cursor to the end of the line.
 *
 * Built from a char code so the source carries no raw ESC byte, which an editor
 * or a patch tool can silently eat; `output/render` builds its patterns the same
 * way for the same reason.
 */
const ERASE_LINE = `${String.fromCharCode(27)}[K`

interface FollowOptions {
  workflow?: string[]
  folder?: string[]
  trigger?: string[]
  level?: string
  details: string
  lines: string
  interval: string
}

/** Collects a repeatable flag, as the generated `list` flags do. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
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
 * Renders one cell the way `logs list` renders it.
 *
 * `runtime/result` keeps its equivalent private and only exposes whole-list
 * printing, which a follow cannot use: it prints a header once and then rows
 * against locked widths, so it needs cells rather than a finished table. The
 * column *definitions* still come from the same contract entry, so the two views
 * cannot drift in what they show — only in how the rows are laid out.
 */
function renderCell(value: unknown, format: ColumnSpec['format']): string {
  switch (format) {
    case 'timestamp':
      return timestamp(value as string | null)
    case 'duration':
      return duration(value as number | null)
    case 'bytes':
      return bytes(value as number | null)
    case 'bool':
      return bool(value as boolean | null)
    case 'cost':
      return typeof value === 'number' ? `$${value.toFixed(4)}` : text(null)
    default:
      return text(typeof value === 'object' && value !== null ? JSON.stringify(value) : value)
  }
}

interface FollowColumn extends Column<LogRow> {
  /** Narrowest this column may lock to, from the contract's `minWidth`. */
  floor: number
}

const COLUMNS: FollowColumn[] = (CLI_CONTRACT.listLogs?.columns ?? []).map((spec) => ({
  header: spec.header,
  floor: Math.min(MAX_CELL_WIDTH, spec.minWidth ?? 0),
  value: (row) => renderCell(at(row, spec.path ?? spec.header), spec.format),
}))

/**
 * Flattens a finished cell onto one line.
 *
 * The shared `sanitize` cannot be used on a finished cell — it strips escape
 * sequences, including the colour the CLI itself just added. The server-supplied
 * text inside the cell was already sanitized by the formatters above.
 */
function oneLine(value: string): string {
  return value.replace(/\s*[\r\n\t]+\s*/g, ' ')
}

function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - visibleWidth(value)))
}

/**
 * Truncates a cell to the widest a column may ever render.
 *
 * Skipped unless the visible width equals the string length, which is only true
 * of text carrying neither an escape sequence nor a wide character — slicing
 * either would cut an escape in half or mis-measure the result.
 */
function clamp(value: string, width: number): string {
  if (visibleWidth(value) <= width || visibleWidth(value) !== value.length) return value
  return `${value.slice(0, Math.max(1, width - 1))}…`
}

type RowWriter = (rows: LogRow[]) => void

/**
 * Prints the header once, then rows against widths locked by the first batch.
 *
 * A follow has no end, so the alternative — one finished table per poll —
 * repeats the header every few seconds and, worse, recomputes the column widths
 * per batch, so no two batches line up and the stream stops reading as one
 * table. Locking the widths is what `kubectl get -w` does, for the same reason.
 * The header prints on the first call even when that call carries no rows, so
 * the columns are labelled from the start rather than from the first run.
 *
 * The lock decides the layout, never the content: a cell wider than its column
 * overflows and pushes the rest of its row right, because clamping to a width
 * the first batch happened to set is how a copyable run id became `9f…`. Cells
 * are still cut at {@link MAX_CELL_WIDTH}, the cap `logs list` uses, so one
 * LLM-sized cell cannot take the view. The contract's per-column floors are
 * what keep the ragged case rare — without them `-n 0` locks every column to
 * its header label and the whole follow prints askew.
 */
function createTableWriter(): RowWriter {
  let widths: number[] | null = null

  return (rows) => {
    const lines = rows.map((row) =>
      COLUMNS.map((column) => clamp(oneLine(column.value(row)), MAX_CELL_WIDTH))
    )

    if (!widths) {
      widths = COLUMNS.map((column, index) =>
        Math.min(
          MAX_CELL_WIDTH,
          Math.max(
            column.floor,
            visibleWidth(column.header),
            ...lines.map((line) => visibleWidth(line[index]))
          )
        )
      )
      const header = widths
      console.log(
        chalk.dim(
          COLUMNS.map((column, index) => pad(column.header.toUpperCase(), header[index]))
            .join('  ')
            .trimEnd()
        )
      )
    }

    const locked = widths
    for (const line of lines) {
      console.log(
        line
          .map((cell, index) => pad(cell, locked[index]))
          .join('  ')
          .trimEnd()
      )
    }
  }
}

/**
 * Picks the writer for the profile's output format.
 *
 * `json` emits one object per line rather than an array, because a follow never
 * closes the bracket that would make an array valid — JSONL is the shape `jq`
 * and `while read` can consume as it arrives. `yaml` becomes a `---` separated
 * document stream for the same reason, and `text` reuses the shared
 * tab-separated rendering, which already prints no header.
 */
function createWriter(format: OutputFormat): RowWriter {
  if (format === 'json') {
    return (rows) => {
      for (const row of rows) console.log(JSON.stringify(row))
    }
  }
  if (format === 'yaml') {
    return (rows) => {
      for (const row of rows) {
        console.log(`---\n${dump(row, { lineWidth: 0, noRefs: true }).trimEnd()}`)
      }
    }
  }
  if (format === 'text') {
    return (rows) => {
      if (rows.length > 0) printList('text', rows, COLUMNS)
    }
  }
  return createTableWriter()
}

export interface FollowStatus {
  /** Replaces the status line, if there is a terminal to draw it on. */
  note: (message: string) => void
  /**
   * Reports something the reader has to know, on its own line.
   *
   * Unlike {@link note} this is not progress and is never erased: it records
   * that rows are missing, which stays true after the follow moves on. It is
   * written even when stderr is not a terminal, because a piped log is exactly
   * where an unexplained hole is hardest to spot.
   */
  warn: (message: string) => void
  /** Erases the line, if anything was ever written to it. */
  clear: () => void
}

/**
 * Reports what the follow is doing, on stderr.
 *
 * The rule `pageProgress` follows: stdout is the stream of rows and gets piped,
 * so anything that is not a row goes to stderr, and only to a terminal.
 */
export function followStatus(): FollowStatus {
  let reported = false
  return {
    note: (message) => {
      if (!process.stderr.isTTY) return
      reported = true
      process.stderr.write(`\r${chalk.dim(message)}${ERASE_LINE}`)
    },
    warn: (message) => {
      if (reported) {
        reported = false
        process.stderr.write(`\r${ERASE_LINE}`)
      }
      process.stderr.write(`warning: ${message}\n`)
    },
    clear: () => {
      if (!reported) return
      reported = false
      process.stderr.write(`\r${ERASE_LINE}`)
    },
  }
}

interface Interruption {
  interrupted: () => boolean
  dispose: () => void
}

/**
 * Turns Ctrl-C into a loop exit rather than a process kill.
 *
 * A follow is meant to be ended by the user, so ending it is a success: the loop
 * finishes the row it is on, drops its listeners and returns, which exits 0 with
 * nothing half-written. Under the default signal disposition the process is torn
 * down wherever it happens to be, which can be mid-row.
 */
function watchForInterrupt(): Interruption {
  let stopped = false
  const stop = () => {
    stopped = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return {
    interrupted: () => stopped,
    dispose: () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    },
  }
}

/**
 * Sleeps in slices, so Ctrl-C is felt within a slice rather than within a poll.
 *
 * The shared `sleep` is not cancellable, and a `--interval 30` follow that only
 * noticed the signal when its timer elapsed would look hung for half a minute
 * after the user asked it to stop.
 */
async function waitFor(ms: number, interrupted: () => boolean): Promise<void> {
  let remaining = ms
  while (remaining > 0 && !interrupted()) {
    const step = Math.min(WAIT_SLICE_MS, remaining)
    await sleep(step)
    remaining -= step
  }
}

/**
 * What the follow has already accounted for.
 *
 * Two facts, because neither is sufficient alone. `seen` is the authority on
 * duplicates: `startedAt` has millisecond resolution and one schedule fan-out
 * starts many runs inside the same millisecond, so a `startedAt > last`
 * watermark silently drops every sibling but one while `>=` reprints them all —
 * and a run persisted out of order would fall below the watermark and never
 * print at all. `floor` is the authority on history: `seen` only holds runs
 * observed since start, so without it any older run reachable on a later page
 * would be printed as though it had just arrived.
 */
interface FollowState {
  seen: Map<string, string>
  floor: string | null
}

function isUnprinted(state: FollowState, row: LogRow): boolean {
  if (state.seen.has(row.runId)) return false
  return state.floor === null || row.startedAt >= state.floor
}

/**
 * Records rows as printed, forgetting the oldest once the cap is reached.
 *
 * Eviction raises the floor to the forgotten runs' own start times, so a run
 * whose id is no longer remembered is excluded by the floor instead of
 * reappearing as new.
 */
function remember(state: FollowState, rows: LogRow[]): void {
  for (const row of rows) state.seen.set(row.runId, row.startedAt)

  let excess = state.seen.size - MAX_REMEMBERED_RUNS
  if (excess <= 0) return

  for (const [runId, startedAt] of state.seen) {
    if (excess <= 0) break
    if (state.floor === null || startedAt > state.floor) state.floor = startedAt
    state.seen.delete(runId)
    excess -= 1
  }
}

/**
 * Walks the newest-first list back to the first row already accounted for, and
 * returns everything above it, still newest first.
 *
 * Paging continues only while a whole page was new, which is the only shape that
 * says there may be more above the previous poll's high-water mark. A page
 * holding one known row proves the rest of the list is older still, so walking
 * further would only re-read history the floor rejects anyway.
 */
/**
 * One poll's worth of new rows, and whether the page budget cut it short.
 *
 * A follow reads a bounded number of pages per poll so one enormous burst
 * cannot stall it indefinitely or buffer without limit. Reaching that bound
 * means older runs from the same burst will never be printed, which is worth
 * saying out loud rather than leaving the reader to notice a hole later.
 */
interface PollBatch {
  rows: LogRow[]
  truncated: boolean
}

async function collectUnprinted(
  client: Pick<SimClient, 'request'>,
  path: string,
  query: Record<string, string | number | undefined>,
  state: FollowState,
  pageSize: number,
  maxPages: number
): Promise<PollBatch> {
  const rows: LogRow[] = []
  let cursor: string | null = null
  let truncated = false

  for (let page = 0; page < maxPages; page += 1) {
    const response: ListLogsResponse = await client.request<ListLogsResponse>(path, {
      query: { ...query, limit: pageSize, cursor },
    })
    const page_rows = response?.data ?? []
    const unprinted = page_rows.filter((row) => isUnprinted(state, row))
    rows.push(...unprinted)

    cursor = response?.nextCursor ?? null
    if (!cursor || page_rows.length === 0 || unprinted.length < page_rows.length) break
    // Every page so far was new and another is waiting, so the burst is larger
    // than one poll may read. The remainder is older than everything collected
    // here and the next poll restarts at the newest page, so it is not coming.
    if (page === maxPages - 1) truncated = true
  }

  return { rows, truncated }
}

/**
 * Whether a failed poll is worth retrying.
 *
 * Status 0 is a transport failure — a dropped connection, a laptop that slept —
 * which is exactly what a follow left running overnight has to survive. An
 * expired key or a rejected filter is not: it fails identically on every poll,
 * so it surfaces once and stops the command instead of scrolling forever.
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof SimApiError)) return false
  if (error.status === 0 || error.status >= 500) return true
  return RETRYABLE_CLIENT_STATUSES.has(error.status)
}

function nonNegativeInteger(raw: string, flag: string): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SimApiError(`${flag} must be a non-negative integer`, 0)
  }
  return value
}

function intervalMs(raw: string): number {
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < MIN_INTERVAL_SECONDS) {
    throw new SimApiError(`--interval must be at least ${MIN_INTERVAL_SECONDS} seconds`, 0)
  }
  return Math.round(seconds * 1000)
}

/** Seconds, to one decimal, for a delay reported to the reader. */
function inSeconds(ms: number): number {
  return Math.round(ms / 100) / 10
}

/**
 * Adds `sim logs follow`.
 *
 * A sibling command rather than `logs list --follow`, because `logs list` is
 * generated from the CLI contract, which describes the HTTP surface: `--follow`
 * has no wire counterpart, and its paging is the inverse of the contract's —
 * re-reading the newest page forever, rather than walking a cursor to the end
 * once. The filters are the same ones `logs list` exposes, so the two commands
 * take the same arguments and render the same columns.
 */
export function attachLogsFollow(logs: Command): void {
  logs
    .command('follow')
    .description('Watch runs as they arrive, printing each new run once')
    .option('--workflow <id>', 'Only follow runs of this workflow (repeatable)', collect, [])
    .option(
      '--folder <path>',
      'Only follow runs of workflows in this folder (repeatable)',
      collect,
      []
    )
    .option('--trigger <type>', 'Only follow runs with this trigger type (repeatable)', collect, [])
    .addOption(
      new Option('--level <level>', 'Only follow runs at this severity').choices([
        ...V2_OPERATIONS.listLogs.query.level.values,
      ])
    )
    .addOption(
      new Option('--details <level>', 'Response detail level; full names each run’s workflow')
        .choices([...V2_OPERATIONS.listLogs.query.details.values])
        .default('full')
    )
    .option('-n, --lines <count>', 'Recent runs to print before watching', String(DEFAULT_BACKLOG))
    .option('--interval <seconds>', 'Seconds between polls', String(DEFAULT_INTERVAL_SECONDS))
    .addHelpText(
      'after',
      `
Each run prints once, when it is first seen, so its status is the status it had
at that moment. With --output json every run is a JSON object on its own line
(JSONL) rather than a member of an array, because a follow never ends and so can
never close one; --output yaml emits a --- separated document stream. Progress
and retries go to stderr, leaving stdout a clean stream of rows. Ctrl-C stops the
follow.

Examples:
  $ sim logs follow --level error
  $ sim logs follow --workflow wf_123 -n 0
  $ sim --output json logs follow | jq -r '.runId'
`
    )
    .action(async (options: FollowOptions, command: Command) => {
      const lines = nonNegativeInteger(options.lines, '--lines')
      const delay = intervalMs(options.interval)

      const { client, profile } = clientFrom(command)
      const path = V2_OPERATIONS.listLogs.path
      const query = {
        workspaceId: client.requireWorkspace(),
        workflowIds: options.workflow?.length ? options.workflow.join(',') : undefined,
        // Encoded exactly as the contract-driven `--folder` encodes it, so a
        // path that works on `logs list` works here; encoding first is also what
        // keeps the comma-joined form unambiguous.
        folderPaths: options.folder?.length
          ? options.folder.map(encodeFolderPath).join(',')
          : undefined,
        triggers: options.trigger?.length ? options.trigger.join(',') : undefined,
        level: options.level,
        details: options.details,
        // Newest first is what the follow loop depends on: the seed page's last
        // row becomes the floor and every poll reads back from the newest page.
        // `listLogs` names these `sortBy`/`sortOrder` and rejects any other key.
        sortBy: 'startedAt',
        sortOrder: 'desc',
      }

      const write = createWriter(profile.output)
      const status = followStatus()
      const interrupt = watchForInterrupt()
      const state: FollowState = { seen: new Map(), floor: null }

      try {
        // The backlog page doubles as the seed: every run on it is recorded and
        // its oldest start time becomes the floor, so even `-n 0` anchors the
        // follow to now instead of replaying the workspace's whole history.
        const seed = await collectUnprinted(client, path, query, state, Math.max(lines, 1), 1)
        remember(state, seed.rows)
        state.floor = seed.rows.at(-1)?.startedAt ?? null
        // The API clamps `limit` into 1–1000 rather than rejecting it, so a
        // larger `-n` comes back short with no indication. Fewer rows than asked
        // for is only a shortfall when more were waiting: a workspace holding
        // ten runs answers `-n 50` with ten and nothing is missing.
        if (seed.truncated && seed.rows.length < lines) {
          status.warn(
            `asked for ${lines} earlier runs but a page holds ${seed.rows.length}; following from there — see sim logs list for more`
          )
        }
        write(lines > 0 ? seed.rows.slice(0, lines).reverse() : [])

        let failures = 0
        while (!interrupt.interrupted()) {
          await waitFor(
            failures === 0 ? delay : Math.min(delay * 2 ** failures, MAX_BACKOFF_MS),
            interrupt.interrupted
          )
          if (interrupt.interrupted()) break

          let fresh: PollBatch
          try {
            fresh = await collectUnprinted(
              client,
              path,
              query,
              state,
              POLL_PAGE_SIZE,
              MAX_PAGES_PER_POLL
            )
          } catch (error) {
            if (!isTransient(error)) throw error
            failures += 1
            const next = Math.min(delay * 2 ** failures, MAX_BACKOFF_MS)
            status.note(
              `poll failed (${(error as SimApiError).message}); retrying in ${inSeconds(next)}s…`
            )
            continue
          }

          // Cleared on success rather than after the empty check: a poll that
          // recovers but finds nothing still ends the retry, and leaving the
          // notice up until rows happen to arrive reports a healthy follow as
          // still failing.
          failures = 0
          status.clear()
          if (fresh.truncated) {
            status.warn(
              `more than ${MAX_PAGES_PER_POLL * POLL_PAGE_SIZE} runs arrived at once; older ones were skipped — see sim logs list`
            )
          }
          if (fresh.rows.length === 0) continue
          remember(state, fresh.rows)
          // Reversed because the API answers newest-first while a terminal reads
          // downwards: the newest run has to end up on the last line.
          write(fresh.rows.reverse())
        }
      } finally {
        status.clear()
        interrupt.dispose()
      }
    })
}
