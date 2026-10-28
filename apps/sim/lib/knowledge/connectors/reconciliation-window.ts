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
 * Reads the next window after `afterId` and the ids in it matching `condition`, in one statement.
 * The matches come back as JSON, which the driver decodes without the array type lookup.
 *
 * The window is the next {@link RECONCILIATION_WINDOW_SIZE} owned documents in id order, found by
 * a recursive keyset walk that asks for one row at a time (`id > previous ORDER BY id LIMIT 1`),
 * so every step is an ordered index probe that stops at its first row: through the v2 index, or
 * the primary key when the connector is nearly the whole table, but never more than a window. A
 * single `ORDER BY id LIMIT` over the connector leaves the planner free to read every document
 * of the connector through another connector index and sort them, which it prefers whenever the
 * connector is small next to the random reads of an ordered walk; one row per step never is.
 * The window is a materialized CTE that shadows `document`, so the walk condition, whatever
 * partial index it implies, is only ever evaluated over the window.
 */
async function scanWindow(walk: ReconciliationWalk, afterId: string | undefined) {
  const owned = and(
    eq(document.connectorId, walk.connectorId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt)
  )
  const [scan] = await db.execute<WindowScan>(sql`
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
    ),
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
