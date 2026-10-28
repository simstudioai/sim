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

export interface ReconciliationCount {
  connectorId: string
  /** Each condition reads the window's columns, as {@link ReconciliationWalk.condition} does. */
  conditions: readonly SQL[]
  deadlineAt: number
  beforePage: () => Promise<void>
}

export type ReconciliationCountResult =
  | { finished: false }
  | {
      finished: true
      /** Every owned document of the connector. */
      owned: number
      /** The owned documents matching each condition, in the conditions' order. */
      matching: number[]
    }

/** A type alias, not an interface, so it satisfies `db.execute`'s row-record constraint. */
type WindowCount = {
  size: number
  last: string | null
  matching: number[]
}

/**
 * Counts a connector's owned documents, and those matching each condition, one window per
 * statement. A connector's documents can number far past what one statement reads inside its
 * timeout, so the counts are summed over the same windows a walk scans, each bounded by
 * {@link RECONCILIATION_WINDOW_SIZE}. Ids never change, so each document is counted in exactly
 * one window. Unfinished when the deadline arrives first.
 */
export async function countReconciliationWindows(
  count: ReconciliationCount
): Promise<ReconciliationCountResult> {
  const filters = sql.join(
    count.conditions.map((condition) => sql`count(*) FILTER (WHERE ${condition})::int`),
    sql`, `
  )
  const matching = count.conditions.map(() => 0)
  let owned = 0
  let covered: string | undefined
  for (;;) {
    if (Date.now() >= count.deadlineAt) return { finished: false }
    await count.beforePage()
    if (Date.now() >= count.deadlineAt) return { finished: false }
    const [window] = await db.execute<WindowCount>(sql`
      ${ownedWindow(count.connectorId, covered)}
      SELECT count(*)::int AS "size", max(${document.id}) AS "last",
        json_build_array(${filters}) AS "matching"
      FROM ${document}`)
    owned += window.size
    window.matching.forEach((value, index) => {
      matching[index] += value
    })
    if (window.size < RECONCILIATION_WINDOW_SIZE || !window.last) {
      return { finished: true, owned, matching }
    }
    covered = window.last
  }
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
    for (let offset = 0; offset < ids.length; offset += walk.pageSize) {
      if (offset > 0) await walk.beforePage()
      /** Materialized ids are acted on only inside the budget, so a late page is left for the next run. */
      if (Date.now() >= walk.deadlineAt) return { finished: false, lastId: covered }
      const page = ids.slice(offset, offset + walk.pageSize)
      await walk.onPage(page.map((id, index) => ({ id, tombstoned: tombstoned[offset + index] })))
      covered = page.at(-1)
    }
    if (size < RECONCILIATION_WINDOW_SIZE || !last) {
      return { finished: true, lastId: last ?? covered }
    }
    covered = last
  }
}
