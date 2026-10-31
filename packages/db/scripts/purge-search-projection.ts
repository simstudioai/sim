import { parseArgs } from 'node:util'
import { createLogger, LogLevel } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('SearchProjectionPurge', { enabled: true, logLevel: LogLevel.INFO })

const DEFAULT_BATCH_SIZE = 2_000
const MAX_BATCH_SIZE = 5_000
const DEFAULT_PAUSE_MS = 1_000
const MAX_PAUSE_MS = 60_000
const STATEMENT_TIMEOUT_MS = 15_000
const LOCK_TIMEOUT_MS = 1_000
/** A probe may walk the dead index entries a purge leaves until VACUUM, so it gets longer. */
const PROBE_STATEMENT_TIMEOUT_MS = 30_000
const PURGE_LOCK = 'sim:search-projection-purge'
/**
 * Whether this backend holds the session-level purge lock. A bigint advisory key appears in
 * `pg_locks` split into `classid` (high 32 bits) and `objid` (low 32 bits) with `objsubid` 1.
 */
const HOLDS_PURGE_LOCK = `EXISTS (
  SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
    AND objsubid = 1 AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('${PURGE_LOCK}', 0)
)`
/**
 * Keeps every scan on `embedding_search_kb_idx`: a sequential scan would restart from the heap's
 * start each batch, over the dead rows earlier batches left, and a bitmap scan would collect a
 * whole knowledge base's rows before its LIMIT applies.
 */
const INDEX_SCANS_ONLY = `set_config('enable_seqscan', 'off', true), set_config('enable_bitmapscan', 'off', true)`

const PURGE_HELP = `Operator-only: delete the candidate rows (embedding_search) of retired Search knowledge
bases (knowledge_base.is_search_index). Canonical embedding and document rows are kept.

MIGRATION_DATABASE_URL=... bun --no-env-file packages/db/scripts/purge-search-projection.ts [--execute] [options]

Without --execute, prints each Search knowledge base's planner row estimate (≈) and whether any
candidate row remains, and changes nothing.
  --execute         Delete in batches, each its own short transaction; any error stops the run.
  --batch-size N    Rows per batch, 1–${MAX_BATCH_SIZE} (default ${DEFAULT_BATCH_SIZE}).
  --pause-ms N      Pause after each batch, 0–${MAX_PAUSE_MS} (default ${DEFAULT_PAUSE_MS}).
  --max-batches N   Stop after N batches; a rerun continues where this one stopped.

MIGRATION_DATABASE_URL must be a direct PlanetScale primary (port 5432, sslmode=verify-full,
sslrootcert=system); poolers are refused. Rerun until the dry run reports none remaining, then,
from a direct primary session outside peak traffic (this script never runs them):
  REINDEX INDEX CONCURRENTLY embedding_search_512_cosine_hnsw_idx;
  VACUUM (ANALYZE) embedding_search;
The full runbook is in the pull request that added this script.`

/** Deliberate operator messages never include database values, credentials or statement text. */
export class SearchProjectionPurgeError extends Error {
  override name = 'SearchProjectionPurgeError'
}

interface OperatorDatabase {
  url: URL
  /** A verified PlanetScale primary rather than a local test fixture. */
  hosted: boolean
}

/**
 * Accepts only a direct PlanetScale primary on port 5432 with verified TLS, or a loopback
 * database whose name has a `test` segment. Poolers (another port, or a `|`-routed role) and
 * connection overrides are refused, because session settings and advisory locks need one backend.
 */
export function parseOperatorDatabaseUrl(rawUrl: string | undefined): OperatorDatabase {
  if (!rawUrl)
    throw new SearchProjectionPurgeError(
      'MIGRATION_DATABASE_URL is required; there is no application DSN fallback'
    )
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SearchProjectionPurgeError('Expected a PostgreSQL URL')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new SearchProjectionPurgeError('Expected a PostgreSQL URL')
  if (!url.username || !url.pathname.slice(1)) {
    throw new SearchProjectionPurgeError(
      'The connection URL must include its role and database name'
    )
  }
  const localFixture =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    /(^|_)test(_|$)/.test(decodeURIComponent(url.pathname.slice(1)))
  const hosted =
    /^[a-z0-9-]+\.(?:pg|horizon)\.psdb\.cloud$/.test(url.hostname) &&
    (url.port || '5432') === '5432' &&
    !decodeURIComponent(url.username).includes('|')
  if (!hosted && !localFixture) {
    throw new SearchProjectionPurgeError(
      'Use a direct PlanetScale primary endpoint on port 5432; unverified endpoints and poolers are unsupported'
    )
  }
  if (
    [...url.searchParams.keys()].some(
      (key) => !['sslmode', 'sslrootcert', 'sslnegotiation'].includes(key)
    )
  ) {
    throw new SearchProjectionPurgeError(
      'Connection overrides are unsupported; only TLS URL parameters are allowed'
    )
  }
  if (
    hosted &&
    (url.searchParams.get('sslmode') !== 'verify-full' ||
      url.searchParams.get('sslrootcert') !== 'system')
  ) {
    throw new SearchProjectionPurgeError(
      'PlanetScale requires sslmode=verify-full and sslrootcert=system'
    )
  }
  return { url, hosted }
}

/**
 * The purge's single-backend client for a validated operator URL. The TLS query parameters are
 * enforced here as `ssl` and removed from the URL: postgres.js forwards `sslrootcert` to the
 * server as a startup parameter, which PostgreSQL rejects as unrecognized. The search path is
 * pinned because the purge reads and deletes unqualified tables. Connects on the first query.
 */
export function connectOperatorDatabase(rawUrl: string | undefined): Sql {
  const { url, hosted } = parseOperatorDatabaseUrl(rawUrl)
  const clientUrl = new URL(url)
  clientUrl.searchParams.delete('sslmode')
  clientUrl.searchParams.delete('sslrootcert')
  return postgres(clientUrl.toString(), {
    port: Number(url.port || '5432'),
    ssl: hosted ? 'verify-full' : false,
    max: 1,
    prepare: false,
    connect_timeout: 5,
    max_lifetime: null,
    connection: {
      application_name: 'sim-search-projection-purge',
      search_path: 'public, pg_temp',
      statement_timeout: STATEMENT_TIMEOUT_MS,
      lock_timeout: LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout: 5_000,
    },
    onnotice: () => undefined,
  })
}

/** Search knowledge bases in id order; the table is small and read once per run. */
async function searchKnowledgeBases(sql: Sql): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM knowledge_base WHERE is_search_index ORDER BY id`
  return rows.map((row) => row.id)
}

interface SearchProjectionState {
  knowledgeBaseId: string
  /** The planner's row estimate (≈), read without scanning; stale until ANALYZE. */
  estimatedRows: number
  /** Whether any candidate row is left, from a one-row probe of `embedding_search_kb_idx`. */
  remaining: boolean
}

/** Per Search knowledge base: a planner estimate and an exact existence probe, no counting scan. */
export async function inspectSearchProjection(sql: Sql): Promise<SearchProjectionState[]> {
  const states: SearchProjectionState[] = []
  for (const knowledgeBaseId of await searchKnowledgeBases(sql)) {
    const state = await sql.begin(async (tx) => {
      await tx`SELECT set_config('statement_timeout', ${`${PROBE_STATEMENT_TIMEOUT_MS}ms`}, true),
        ${tx.unsafe(INDEX_SCANS_ONLY)}`
      const [explained] = await tx<{ 'QUERY PLAN': Array<{ Plan: { 'Plan Rows': number } }> }[]>`
        EXPLAIN (FORMAT JSON) SELECT 1 FROM embedding_search WHERE knowledge_base_id = ${knowledgeBaseId}`
      const [probe] = await tx<{ remaining: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM embedding_search WHERE knowledge_base_id = ${knowledgeBaseId}
        ) AS remaining`
      return {
        knowledgeBaseId,
        estimatedRows: explained['QUERY PLAN'][0].Plan['Plan Rows'],
        remaining: probe.remaining,
      }
    })
    states.push(state)
  }
  return states
}

interface SearchProjectionPurgeOptions {
  batchSize?: number
  pauseMs?: number
  /** Stop after this many batches, leaving the rest for a rerun; unbounded otherwise. */
  maxBatches?: number
  /** Called after each batch commits, for tests that change the database between batches. */
  onBatch?: (batch: { knowledgeBaseId: string; deleted: number }) => Promise<void> | void
}

interface SearchProjectionPurgeResult {
  deleted: number
  batches: number
  /** Whether the run stopped at `maxBatches` with rows possibly left. */
  remaining: boolean
}

/**
 * Deletes one batch of a Search knowledge base's candidate rows. The rows are chosen through
 * `embedding_search_kb_idx` and locked by one statement, then deleted by tuple id in the next.
 * The lock returns a concurrently updated row at its current tuple id and keeps it there, and the
 * delete's later snapshot sees that version, so an empty batch means no row is left. The knowledge
 * base re-check leaves a reassigned row alone. Deletes nothing when the knowledge base is gone.
 * Refuses when this backend no longer holds the purge lock: the client reconnects silently after a
 * dropped connection, and the new backend does not inherit the old one's session lock.
 */
async function purgeBatch(sql: Sql, knowledgeBaseId: string, batchSize: number): Promise<number> {
  return sql.begin(async (tx) => {
    const [session] = await tx<{ locked: boolean }[]>`
      SELECT ${tx.unsafe(HOLDS_PURGE_LOCK)} AS locked, ${tx.unsafe(INDEX_SCANS_ONLY)}`
    if (!session.locked) {
      throw new SearchProjectionPurgeError(
        'The database connection was replaced and no longer holds the purge lock; rerun to continue'
      )
    }
    const [base] = await tx<{ is_search_index: boolean }[]>`
      SELECT is_search_index FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR SHARE`
    if (!base) return 0
    if (!base.is_search_index) {
      throw new SearchProjectionPurgeError(
        'A knowledge base is no longer Search-marked; stopped before deleting its candidate rows'
      )
    }
    const [chosen] = await tx<{ ctids: string | null }[]>`
      SELECT array_agg(ctid)::text AS ctids FROM (
        SELECT ctid FROM embedding_search WHERE knowledge_base_id = ${knowledgeBaseId}
        LIMIT ${batchSize} FOR UPDATE
      ) batch`
    if (!chosen.ctids) return 0
    const [row] = await tx<{ deleted: number }[]>`
      WITH deleted AS (
        DELETE FROM embedding_search
        WHERE ctid = ANY (${chosen.ctids}::tid[]) AND knowledge_base_id = ${knowledgeBaseId}
        RETURNING 1
      )
      SELECT count(*)::int AS deleted FROM deleted`
    return row.deleted
  })
}

/**
 * Deletes the candidate rows of every Search knowledge base, batch by batch, pausing after each,
 * while holding a session lock that keeps a second run out. Stateless: whatever a stopped run
 * leaves, the next run finds and deletes. Canonical `embedding` and `document` rows are never
 * touched.
 */
export async function purgeSearchProjection(
  sql: Sql,
  options: SearchProjectionPurgeOptions = {}
): Promise<SearchProjectionPurgeResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY
  const [{ acquired }] = await sql<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_lock(hashtextextended(${PURGE_LOCK}, 0)) AS acquired`
  if (!acquired) throw new SearchProjectionPurgeError('Another purge is running')
  let deleted = 0
  let batches = 0
  try {
    for (const knowledgeBaseId of await searchKnowledgeBases(sql)) {
      for (;;) {
        if (batches >= maxBatches) return { deleted, batches, remaining: true }
        const count = await purgeBatch(sql, knowledgeBaseId, batchSize)
        if (count === 0) break
        batches += 1
        deleted += count
        await options.onBatch?.({ knowledgeBaseId, deleted: count })
        if (pauseMs > 0) await sleep(pauseMs)
      }
    }
    return { deleted, batches, remaining: false }
  } finally {
    // On a replaced connection this unlocks nothing; the old backend's lock ended with it.
    await sql`SELECT pg_advisory_unlock(hashtextextended(${PURGE_LOCK}, 0))`
  }
}

function integerOption(
  value: string | undefined,
  fallback: number,
  floor: number,
  ceiling = Number.MAX_SAFE_INTEGER
): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < floor || parsed > ceiling) {
    throw new SearchProjectionPurgeError(`Expected an integer between ${floor} and ${ceiling}`)
  }
  return parsed
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', default: false },
      execute: { type: 'boolean', default: false },
      'batch-size': { type: 'string' },
      'pause-ms': { type: 'string' },
      'max-batches': { type: 'string' },
    },
  })
  if (values.help) {
    process.stdout.write(`${PURGE_HELP}\n`)
    return
  }
  const batchSize = integerOption(values['batch-size'], DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
  const pauseMs = integerOption(values['pause-ms'], DEFAULT_PAUSE_MS, 0, MAX_PAUSE_MS)
  const maxBatches =
    values['max-batches'] === undefined ? undefined : integerOption(values['max-batches'], 1, 1)
  const sql = connectOperatorDatabase(process.env.MIGRATION_DATABASE_URL)
  try {
    if (!values.execute) {
      const states = await inspectSearchProjection(sql)
      logger.info('Search candidate rows (dry run; nothing deleted; estimatedRows is ≈)', {
        knowledgeBases: states,
        remaining: states.some((state) => state.remaining),
      })
      return
    }
    const [session] = await sql<{ writable: boolean; retirement_installed: boolean }[]>`
      SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off' AS writable,
        to_regclass('public.search_retirement_state') IS NOT NULL AS retirement_installed`
    if (!session.writable)
      throw new SearchProjectionPurgeError('The purge requires a writable primary connection')
    if (session.retirement_installed)
      throw new SearchProjectionPurgeError(
        'A shadow-copy Search retirement job is still installed; abort it with the release that shipped it first'
      )
    const result = await purgeSearchProjection(sql, {
      batchSize,
      pauseMs,
      maxBatches,
      onBatch: (batch) => logger.info('Search candidate batch deleted', batch),
    })
    logger.info('Search candidate purge finished', {
      ...result,
      next: result.remaining
        ? 'Rerun to continue'
        : 'Confirm a dry run reports none remaining, then REINDEX and VACUUM as --help describes',
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    // PostgreSQL errors may contain row values or credentials; never log their query, detail or stack.
    const code = getPostgresErrorCode(error)
    let reason = 'Preflight or command failed; use --help to check options'
    if (error instanceof SearchProjectionPurgeError) reason = error.message
    else if (code) reason = 'Database refused the operation'
    logger.error('Search candidate purge stopped; committed batches stay deleted', {
      reason,
      ...(code ? { code } : {}),
    })
    process.exitCode = 1
  }
}
