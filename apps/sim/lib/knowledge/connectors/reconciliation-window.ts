import { db } from '@sim/db'
import { document } from '@sim/db/schema'
import { and, eq, gt, isNull, type SQL, sql } from 'drizzle-orm'

/**
 * Ids of `doc_connector_reconciliation_v2_idx` one reconciliation statement may scan. The rows a
 * walk looks for can be rare and late in id order, so a page bounded only by its matches could
 * read, and heap-fetch, a whole connector in one statement. Each window instead scans at most
 * this many ids: a few hundred milliseconds cold, and few enough round trips that a large
 * connector is walked in hundreds of statements rather than thousands.
 */
export const RECONCILIATION_WINDOW_SIZE = 5_000

interface ReconciliationRow {
  id: string
  /** Whether the row is already a tombstone, for walks that treat tombstones and live rows apart. */
  tombstoned: boolean
}

export interface ReconciliationWalk {
  connectorId: string
  /** Resumes after this document id, the `lastId` an earlier walk stopped at. */
  startAfterId?: string
  /**
   * Evaluated over the window's rows, which carry only the document's id, connector, exclusion,
   * archival, tombstone, seen, ACL and content-hash columns.
   */
  condition: SQL | undefined
  /** At most this many matches are handed to one `onPage`. */
  pageSize: number
  deadlineAt: number
  beforePage: () => Promise<void>
  onPage: (rows: ReconciliationRow[]) => Promise<void>
}

export interface ReconciliationWalkResult {
  /** False when the deadline stopped the walk. */
  finished: boolean
  /** The last document id the walk covered, from which a stopped walk resumes. */
  lastId: string | undefined
}

/** A type alias, not an interface, so it satisfies `db.execute`'s row-record constraint. */
type WindowScan = {
  size: number
  last: string | null
  ids: string[]
  tombstoned: boolean[]
}

/** The document columns a walk condition may read, as the window carries them. */
const WINDOW_COLUMNS = sql.raw(
  'id, connector_id, user_excluded, archived_at, deleted_at, source_seen_at, acl, content_hash'
)

/**
 * The next {@link RECONCILIATION_WINDOW_SIZE} owned documents after `afterId` in id order, as a
 * materialized CTE that shadows `document`, so a condition over it, whatever partial index it
 * implies, is only ever evaluated over the window.
 *
 * The window is found by a recursive keyset walk that asks for one row at a time
 * (`id > previous ORDER BY id LIMIT 1`), so every step is an ordered index probe that stops at its
 * first row: through the v2 index, or the primary key when the connector is nearly the whole
 * table, but never more than a window. A single `ORDER BY id LIMIT` over the connector leaves the
 * planner free to read every document of the connector through another connector index and sort
 * them, which it prefers whenever the connector is small next to the random reads of an ordered
 * walk; one row per step never is.
 */
function ownedWindow(connectorId: string, afterId: string | undefined): SQL {
  const owned = and(
    eq(document.connectorId, connectorId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt)
  )
  return sql`
    WITH ${document} AS MATERIALIZED (
      WITH RECURSIVE walk AS (
        (
          SELECT ${WINDOW_COLUMNS}, 1 AS step FROM ${document}
          WHERE ${and(owned, afterId ? gt(document.id, afterId) : undefined)}
          ORDER BY ${document.id} LIMIT 1
        )
        UNION ALL
        SELECT next.*, walk.step + 1 FROM walk CROSS JOIN LATERAL (
          SELECT ${WINDOW_COLUMNS} FROM ${document}
          WHERE ${owned} AND ${document.id} > walk.id
          ORDER BY ${document.id} LIMIT 1
        ) next
        WHERE walk.step < ${RECONCILIATION_WINDOW_SIZE}
      )
      SELECT ${WINDOW_COLUMNS} FROM walk
    )`
}

/**
 * Reads the next window after `afterId` and the ids in it matching `condition`, in one statement.
 * The matches come back as JSON, which the driver decodes without the array type lookup.
 */
async function scanWindow(walk: ReconciliationWalk, afterId: string | undefined) {
  const [scan] = await db.execute<WindowScan>(sql`
    ${ownedWindow(walk.connectorId, afterId)},
    matched AS (
      SELECT ${document.id} AS id, ${document.deletedAt} IS NOT NULL AS tombstoned
      FROM ${document}
      WHERE ${walk.condition ?? sql`true`}
    )
    SELECT
      (SELECT count(*)::int FROM ${document}) AS "size",
      (SELECT max(${document.id}) FROM ${document}) AS "last",
      coalesce(json_agg(id ORDER BY id), '[]') AS "ids",
      coalesce(json_agg(tombstoned ORDER BY id), '[]') AS "tombstoned"
    FROM matched`)
  return scan
}

/**
 * Matching rows one tally keeps per condition. Past it a condition keeps only its count, and acting
 * on its matches walks the connector again, so a tally's memory and the rows each window statement
 * returns stay bounded however many documents a source drops. Far above the removals an ordinary
 * sync reconciles, and at least the deletion cap of every connector of up to 40,000 documents.
 */
export const RECONCILIATION_RETAINED_MATCHES = 10_000

interface ReconciliationCondition {
  /** Reads the window's columns, as {@link ReconciliationWalk.condition} does. */
  where: SQL
  /** Whether the tally keeps the matching rows, for a caller that may act on them. */
  retain: boolean
}

export interface ReconciliationTally {
  connectorId: string
  conditions: readonly ReconciliationCondition[]
  deadlineAt: number
  beforePage: () => Promise<void>
}

export interface ReconciliationMatches {
  /** The owned documents matching the condition. */
  count: number
  /**
   * Every one of them in id order, as its window read it; undefined when the condition is not
   * retained or matched more than {@link RECONCILIATION_RETAINED_MATCHES}.
   */
  rows: ReconciliationRow[] | undefined
}

export type ReconciliationTallyResult =
  | { finished: false }
  | {
      finished: true
      /** Every owned document of the connector. */
      owned: number
      /** The matches of each condition, in the conditions' order. */
      matching: ReconciliationMatches[]
    }

/** A type alias, not an interface, so it satisfies `db.execute`'s row-record constraint. */
type WindowTally = {
  size: number
  last: string | null
  counts: number[]
  /** Per condition, its matching ids in id order; empty for a condition no longer retained. */
  ids: string[][]
  tombstoned: boolean[][]
}

/**
 * Counts a connector's owned documents and those matching each condition, keeping the matching
 * rows of each retained condition, one window per statement. A connector's documents can number
 * far past what one statement reads inside its timeout, so the tally is summed over the windows a
 * walk scans, each bounded by {@link RECONCILIATION_WINDOW_SIZE}, and a caller acting on the
 * retained rows ({@link visitReconciliationMatches}) never reads the connector a second time.
 *
 * Ids never change, so each document is counted in exactly one window, in the state it had when
 * that window's statement ran: the sums are not one snapshot, and differ from one only by the rows
 * writers outside the sync lease changed during the tally. The retained rows are the ones counted,
 * so what a caller acts on is what its decision weighed; each removal still re-checks its target
 * in its own statement. Unfinished when the deadline arrives first.
 */
export async function tallyReconciliationWindows(
  tally: ReconciliationTally
): Promise<ReconciliationTallyResult> {
  const tallies: (ReconciliationMatches & { where: SQL })[] = tally.conditions.map(
    ({ where, retain }) => ({ where, count: 0, rows: retain ? [] : undefined })
  )
  /** Each condition is evaluated once per row, into `matched.matches` at its 1-based position. */
  const evaluated = sql.join(
    tallies.map(({ where }) => sql`(${where})`),
    sql`, `
  )
  const perCondition = (aggregate: (match: SQL, rows: ReconciliationRow[] | undefined) => SQL) =>
    sql.join(
      tallies.map(({ rows }, index) => aggregate(sql.raw(`matches[${index + 1}]`), rows)),
      sql`, `
    )
  /** A condition no longer retained aggregates nothing, so its window returns only the count. */
  const retained = (column: string) =>
    perCondition((match, rows) =>
      rows
        ? sql`coalesce(json_agg(${sql.raw(column)} ORDER BY id) FILTER (WHERE ${match}), '[]')`
        : sql`'[]'::json`
    )
  let owned = 0
  let covered: string | undefined
  for (;;) {
    if (Date.now() >= tally.deadlineAt) return { finished: false }
    await tally.beforePage()
    if (Date.now() >= tally.deadlineAt) return { finished: false }
    const [window] = await db.execute<WindowTally>(sql`
      ${ownedWindow(tally.connectorId, covered)},
      matched AS (
        SELECT ${document.id} AS id, ${document.deletedAt} IS NOT NULL AS tombstoned,
          ARRAY[${evaluated}]::boolean[] AS matches
        FROM ${document}
      )
      SELECT count(*)::int AS "size", max(id) AS "last",
        json_build_array(${perCondition((match) => sql`count(*) FILTER (WHERE ${match})::int`)}) AS "counts",
        json_build_array(${retained('id')}) AS "ids",
        json_build_array(${retained('tombstoned')}) AS "tombstoned"
      FROM matched`)
    owned += window.size
    tallies.forEach((matches, index) => {
      matches.count += window.counts[index] ?? 0
      if (!matches.rows) return
      if (matches.count > RECONCILIATION_RETAINED_MATCHES) {
        matches.rows = undefined
        return
      }
      const tombstoned = window.tombstoned[index] ?? []
      for (const [row, id] of (window.ids[index] ?? []).entries())
        matches.rows.push({ id, tombstoned: tombstoned[row] ?? false })
    })
    if (window.size < RECONCILIATION_WINDOW_SIZE || !window.last) {
      return {
        finished: true,
        owned,
        matching: tallies.map(({ count, rows }) => ({ count, rows })),
      }
    }
    covered = window.last
  }
}

export interface ReconciliationVisit
  extends Pick<ReconciliationWalk, 'pageSize' | 'deadlineAt' | 'beforePage' | 'onPage'> {
  connectorId: string
  /** The tallied condition, walked again when its rows were not retained. */
  condition: SQL
  matches: ReconciliationMatches
}

/**
 * Hands a tallied condition's matches to `onPage` in pages of at most `pageSize`: the rows the
 * tally retained, or, when it kept only their count, a fresh walk of the connector for the
 * condition. False when the deadline stopped it.
 */
export async function visitReconciliationMatches(visit: ReconciliationVisit): Promise<boolean> {
  if (!visit.matches.rows) return (await walkReconciliationWindows(visit)).finished
  return (await handPages(visit.matches.rows, visit, false)).finished
}

/**
 * Hands `rows` to `onPage` in pages, beating before each one the caller has not already beaten
 * for. Materialized rows are acted on only inside the budget, so a late page is left for the next
 * run; `lastId` is the last row handed over.
 */
async function handPages(
  rows: readonly ReconciliationRow[],
  pages: Pick<ReconciliationWalk, 'pageSize' | 'deadlineAt' | 'beforePage' | 'onPage'>,
  firstPageBeaten: boolean
): Promise<{ finished: boolean; lastId: string | undefined }> {
  let lastId: string | undefined
  for (let offset = 0; offset < rows.length; offset += pages.pageSize) {
    if (offset > 0 || !firstPageBeaten) await pages.beforePage()
    if (Date.now() >= pages.deadlineAt) return { finished: false, lastId }
    const page = rows.slice(offset, offset + pages.pageSize)
    await pages.onPage(page)
    lastId = page.at(-1)?.id
  }
  return { finished: true, lastId }
}

/**
 * Walks a connector's owned documents in id order from `startAfterId`, one window per statement,
 * handing the rows matching `condition` to `onPage` in pages of at most `pageSize`. A window
 * without matches still advances the walk, which ends after the first window shorter than a full
 * one.
 */
export async function walkReconciliationWindows(
  walk: ReconciliationWalk
): Promise<ReconciliationWalkResult> {
  let covered = walk.startAfterId
  for (;;) {
    if (Date.now() >= walk.deadlineAt) return { finished: false, lastId: covered }
    await walk.beforePage()
    if (Date.now() >= walk.deadlineAt) return { finished: false, lastId: covered }
    const { size, last, ids, tombstoned } = await scanWindow(walk, covered)
    const handed = await handPages(
      ids.map((id, index) => ({ id, tombstoned: tombstoned[index] })),
      walk,
      true
    )
    covered = handed.lastId ?? covered
    if (!handed.finished) return { finished: false, lastId: covered }
    if (size < RECONCILIATION_WINDOW_SIZE || !last) {
      return { finished: true, lastId: last ?? covered }
    }
    covered = last
  }
}
