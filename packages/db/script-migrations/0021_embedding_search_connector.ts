import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import postgres, { type Sql } from 'postgres'
import { resolveMigrationDatabaseUrl } from './database-url'

const logger = createLogger('ProjectionSourceAcl')

/**
 * Chunks filled per page. Every write to `embedding_search` re-inserts the row into each of its
 * HNSW indexes, so a page's cost is index maintenance rather than the plan, and a small page keeps
 * each transaction short and its locks brief.
 */
export const PROJECTION_SOURCE_ACL_PAGE_SIZE = 100

/** Pause between pages, so the backfill shares the database with the search it serves. */
export const PROJECTION_SOURCE_ACL_PAGE_PAUSE_MS = 250

/**
 * Longest a page may run before the database cancels it; the run then fails and resumes. A caller
 * that bounds a run leaves at least this much headroom after its budget, since the budget is
 * checked between pages and the page in flight runs to this limit.
 */
export const PROJECTION_SOURCE_ACL_PAGE_TIMEOUT_MS = 60_000

/** Pages between progress log lines. */
const PROGRESS_EVERY_PAGES = 100

/** The projections that carry their document's source and ACL. */
export const PROJECTION_SOURCE_ACL_TABLES = ['embedding_search', 'embedding_keyword_tin'] as const
export type ProjectionSourceAclTable = (typeof PROJECTION_SOURCE_ACL_TABLES)[number]

/**
 * Carries a chunk's source and ACL onto the ranking projections and keeps them there.
 *
 * Each projection's own trigger reads both from the chunk's document on every write, under a share
 * lock so a write and a document's change cannot interleave; a document that changes hands or whose
 * ACL is rewritten fans the new values out to the chunks a search can reach, which is what the
 * enabled-row lookup indexes cover. A disabled chunk takes both from its document again when it is
 * enabled, so it rejoins current rather than stale.
 *
 * With the source and ACL on the row, ranking decides readability on the row it scores — inside the
 * vector walk and inside the keyword window — instead of through a join per candidate. Hydration
 * still reads content under the full predicate.
 */
export async function installProjectionSourceAcl(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_projection_source_acl()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE embedding_search SET connector_id = NEW.connector_id, acl = NEW.acl
        WHERE document_id = NEW.id AND enabled
          AND (connector_id IS DISTINCT FROM NEW.connector_id OR acl IS DISTINCT FROM NEW.acl);
        UPDATE embedding_keyword_tin SET connector_id = NEW.connector_id, acl = NEW.acl
        WHERE document_id = NEW.id AND enabled
          AND (connector_id IS DISTINCT FROM NEW.connector_id OR acl IS DISTINCT FROM NEW.acl);
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER projection_source_acl_sync
      AFTER INSERT OR UPDATE OF connector_id, acl ON document
      FOR EACH ROW EXECUTE FUNCTION sync_projection_source_acl()`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION set_projection_source_acl()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        SELECT connector_id, acl INTO NEW.connector_id, NEW.acl FROM document
        WHERE id = NEW.document_id FOR SHARE;
        RETURN NEW;
      END;
      $$`)
    for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
      await tx.unsafe(`CREATE OR REPLACE TRIGGER ${projection}_source_acl_set
        BEFORE INSERT OR UPDATE OF document_id, enabled ON ${projection}
        FOR EACH ROW EXECUTE FUNCTION set_projection_source_acl()`)
    }
    /** The earlier shape of this migration, where the source alone was carried, and only on vectors. */
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_search_connector_sync ON document')
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_search_connector_set ON embedding_search')
    await tx.unsafe('DROP FUNCTION IF EXISTS sync_embedding_search_connector()')
    await tx.unsafe('DROP FUNCTION IF EXISTS set_embedding_search_connector()')
  })
}

export interface ProjectionSourceAclBackfillOptions {
  /** Resume after this chunk id; the projection's first page otherwise. */
  afterId?: string
  /** Stop before this chunk id; the projection's end otherwise. Lets workers fill disjoint ranges. */
  beforeId?: string
  pageSize?: number
  pauseMs?: number
  /** Stop once this much time has passed and report where to resume; unbounded otherwise. */
  budgetMs?: number
}

export interface ProjectionSourceAclBackfillProgress {
  projection: ProjectionSourceAclTable
  /** Unfilled chunks this run read, including any a concurrent write filled first. */
  scanned: number
  written: number
  /** The last chunk id this run reached; the next run resumes after it while `done` is false. */
  afterId: string
  done: boolean
}

/**
 * Fills a projection's source and ACL for chunks written before the trigger existed, in
 * independently committed keyset pages of unfilled rows. Each page is one statement that bounds
 * its own locking and runtime and writes only rows still unset, so an interrupted run resumes by
 * rerunning and a row the trigger has since written is left alone. The documents are share-locked
 * before their values are copied, so a change in flight waits for the page and then fans its own
 * values out; and a chunk that moved to another document meanwhile is left to that document's
 * trigger, since the write requires the document the values were read from.
 *
 * On `embedding_search` every filled row is re-inserted into each HNSW index, which is the whole
 * cost of a page and far more than a deploy can wait for; the run paces itself with a pause between
 * pages and stops at its budget so a background task can chain runs until the projection is filled.
 * Search does not wait: an unfilled row is decided on its document by the on-row candidate
 * predicate, the join per candidate every row paid before the columns existed. A run fills the
 * range it was given and reports that range done; whether the projection as a whole is done, and
 * the analysis the planner then needs, is the caller's, since several runs may share a projection.
 */
export async function backfillProjectionSourceAcl(
  sql: Sql,
  projection: ProjectionSourceAclTable,
  options: ProjectionSourceAclBackfillOptions = {}
): Promise<ProjectionSourceAclBackfillProgress> {
  const pageSize = options.pageSize ?? PROJECTION_SOURCE_ACL_PAGE_SIZE
  const pauseMs = options.pauseMs ?? PROJECTION_SOURCE_ACL_PAGE_PAUSE_MS
  /**
   * The page size is interpolated into the statement and a page of nothing would report the
   * projection filled; a payload that asks for either is refused rather than quietly reshaped.
   */
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error(`Projection backfill page size must be a positive integer, got ${pageSize}`)
  }
  if (!Number.isFinite(pauseMs) || pauseMs < 0) {
    throw new Error(`Projection backfill pause must be a non-negative number, got ${pauseMs}`)
  }
  const startedAt = Date.now()
  const deadline =
    options.budgetMs === undefined ? Number.POSITIVE_INFINITY : startedAt + options.budgetMs
  let afterId = options.afterId ?? ''
  const beforeId = options.beforeId ?? null
  let scanned = 0
  let written = 0
  let pages = 0
  let done = false
  for (;;) {
    const page = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe(`SET LOCAL statement_timeout = ${PROJECTION_SOURCE_ACL_PAGE_TIMEOUT_MS}`)
      const [row] = await tx.unsafe<
        Array<{ scanned: number; filled: number; last_id: string | null }>
      >(
        `WITH page AS (
          SELECT s.id, s.document_id, d.connector_id, d.acl
          FROM ${projection} s JOIN document d ON d.id = s.document_id
          WHERE s.id > $1 AND ($2::text IS NULL OR s.id < $2) AND s.acl IS NULL
          ORDER BY s.id LIMIT ${pageSize}
          FOR SHARE OF d
        ), updated AS (
          UPDATE ${projection} s SET connector_id = page.connector_id, acl = page.acl
          FROM page
          WHERE s.id = page.id AND s.document_id = page.document_id AND s.acl IS NULL
          RETURNING s.id
        )
        SELECT (SELECT count(*)::int FROM page) AS scanned,
          (SELECT count(*)::int FROM updated) AS filled,
          (SELECT max(id) FROM page) AS last_id`,
        [afterId, beforeId]
      )
      return row
    })
    if (page.last_id === null) {
      done = true
      break
    }
    afterId = page.last_id
    scanned += page.scanned
    written += page.filled
    pages += 1
    if (pages % PROGRESS_EVERY_PAGES === 0) {
      logger.info('Projection source and ACL backfill progress', {
        projection,
        scanned,
        written,
        afterId,
        elapsedMs: Date.now() - startedAt,
      })
    }
    if (pauseMs > 0) await sleep(pauseMs)
    /** Checked after the pause, so the pause cannot carry a run past its budget into another page. */
    if (Date.now() >= deadline) break
  }
  logger.info(
    done
      ? 'Projection source and ACL range backfilled'
      : 'Projection source and ACL backfill paused',
    {
      projection,
      beforeId,
      scanned,
      written,
      afterId,
      elapsedMs: Date.now() - startedAt,
    }
  )
  return { projection, scanned, written, afterId, done }
}

/**
 * The indexes exact ranking of a readable set needs: the ACL index on each projection, and on the
 * vector projection the source index that lets the planner lead with a few sources when the
 * caller's tokens alone would match most of the index. Built concurrently, so the triggers and the
 * backfill keep writing. `CONCURRENTLY` cannot run in a transaction, and the pool's lock timeout
 * would cancel a build that merely waits for a long transaction to finish. The timeout is a
 * session setting, so one connection is reserved for it, the builds, and the reset — a pool
 * would otherwise hand the builds to connections that never saw the setting.
 *
 * The unfilled index on each projection lists the rows the backfill has not reached: each page
 * reads its rows from it instead of walking past every filled one, and the on-row predicate's
 * unfilled branch, an `OR` beside the ACL overlap, stays an index probe for the planner — once the
 * projection is filled, a probe of an empty index.
 */
export async function indexProjectionAcl(pool: Sql): Promise<void> {
  const sql = await pool.reserve()
  const [{ timeout }] = await sql`SELECT current_setting('lock_timeout') AS timeout`
  await sql.unsafe('SET lock_timeout = 0')
  try {
    const builds: Array<[name: string, definition: string]> = [
      ...PROJECTION_SOURCE_ACL_TABLES.flatMap(
        (projection): Array<[string, string]> => [
          [`${projection}_acl_gin_idx`, `ON ${projection} USING gin (acl) WHERE enabled`],
          [`${projection}_acl_unfilled_idx`, `ON ${projection} (id) WHERE acl IS NULL`],
        ]
      ),
      ['embedding_search_source_idx', 'ON embedding_search (connector_id) WHERE enabled'],
    ]
    for (const [name, definition] of builds) {
      /**
       * An interrupted concurrent build leaves an invalid index behind, and `IF NOT EXISTS` would
       * then keep it; only a leftover that cannot be used is dropped before building again.
       */
      const [leftover] = await sql<Array<{ invalid: boolean }>>`
        SELECT NOT i.indisvalid OR NOT i.indisready AS invalid
        FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = ${name}`
      if (leftover?.invalid) await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`)
      await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ${definition}`)
    }
    /** The new columns carry no statistics until analyzed; the reach and source predicates plan on them. */
    for (const projection of PROJECTION_SOURCE_ACL_TABLES) await sql.unsafe(`ANALYZE ${projection}`)
  } finally {
    await sql`SELECT set_config('lock_timeout', ${timeout}, false)`
    sql.release()
  }
}

/**
 * Run directly — `db:push`, or an operator filling a database by hand — the projections are filled
 * here, paced the same way, rather than left to the app. The registered migration is
 * `0022_projection_source_acl_backfill`, which supersedes this file's earlier, synchronous shape.
 */
if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required to backfill the projection source and ACL')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await installProjectionSourceAcl(sql)
    await indexProjectionAcl(sql)
    for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
      await backfillProjectionSourceAcl(sql, projection)
    }
  } finally {
    await sql.end()
  }
}
