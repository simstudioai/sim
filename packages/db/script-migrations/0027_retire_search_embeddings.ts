import { type ScriptMigration, ScriptMigrationDeferred } from '@sim/db/script-migrations/types'
import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { createLogger } from '@sim/logger'
import { getPostgresCancellationReason } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import type { Sql, TransactionSql } from 'postgres'

const logger = createLogger('RetireSearchEmbeddings')
/** Most IDs one page reads in primary-key order; reading is cheap next to the mutation. */
const SCAN_PAGE_SIZE = 25_000
/**
 * A page reads at most this many IDs per row it may mutate. A page that reaches the row limit is
 * re-read from its last mutated row, so a window far wider than the limit would be read again and
 * again as the limit shrinks, exactly when the database is already slow.
 */
const SCAN_ROWS_PER_MUTATION = 4
/**
 * Rows one page may update or delete. Every retired document is a non-HOT update touching each of
 * its indexes, and every deleted chunk cascades into its projections, so the write cost of a page,
 * not its scan, is what can outrun the statement timeout.
 */
const ROW_LIMIT = { initial: 2_000, min: 25, max: 8_000 } as const
/** A page slower than this halves the row limit. */
const SLOW_PAGE_MS = 30_000
/**
 * A page faster than this doubles the row limit, widening its scan window with it, but never back
 * to a size that timed out.
 */
const FAST_PAGE_MS = SLOW_PAGE_MS / 4
const LOCK_RETRY_BUDGET_MS = 60_000
/** One runner at a time: the deploy slice defers while the background runner holds it, and vice versa. */
const RETIREMENT_LOCK = 'sim:search-retirement'

/**
 * How the cleanup yields to the database's own load. Every page is followed by the longest of three
 * pauses, capped at `maxPauseMs`: a duty-cycle pause proportional to the page, a WAL pause that
 * keeps the database's WAL rate inside the budget, and an exponential back-off while commits are
 * slow or a replica lags.
 */
export interface RetirementThrottle {
  /** Pause after each page as a multiple of its duration; 1 keeps the cleanup busy at most half the time. */
  dutyRatio: number
  /**
   * Share of `max_wal_size` the database may write per `checkpoint_timeout` while the cleanup runs,
   * counting every writer, so checkpoints stay time-triggered instead of WAL-triggered. A burst of
   * WAL-triggered checkpoints re-logs a full image of each page first touched after every
   * checkpoint, which is what multiplies WAL during a bulk delete.
   */
  walBudgetShare: number
  /** A page commit slower than this backs off. It includes the synchronous-replication wait. */
  slowCommitMs: number
  /** The first back-off after a slow commit or a lagging replica; it doubles while either persists. */
  backoffMs: number
  maxPauseMs: number
  /** Replication lag (write, flush or replay) above this pauses before the next page. */
  maxReplicaLagMs: number
}

export const DEFAULT_RETIREMENT_THROTTLE: RetirementThrottle = {
  dutyRatio: 1,
  walBudgetShare: 0.1,
  slowCommitMs: 1_000,
  backoffMs: 15_000,
  maxPauseMs: 5 * 60_000,
  maxReplicaLagMs: 10_000,
}

export interface RetirementRunOptions {
  /** `performance.now()` after which no page starts; a page already running finishes. */
  deadline?: number
  throttle?: Partial<RetirementThrottle>
}

/** `complete` once every captured KB is retired; `deferred` when the budget ran out or another runner holds the lock. */
export type RetirementOutcome = 'complete' | 'deferred'

type Phase = 'documents' | 'embeddings' | 'done'

interface PageResult {
  done: boolean
  /** The phase the page ran in. */
  phase: Phase
  /** The cursor the page committed. */
  afterId: string
  /** Rows the page updated or deleted. */
  mutated: number
  /** A phase change the page committed. */
  transition?: 'embeddings' | 'documents_rescan' | 'embeddings_rescan'
  /** Time from the page's last statement to its acknowledged commit. */
  commitMs: number
}

/**
 * A statement timeout from a page's mutating statement, the only statement a smaller page speeds
 * up. Any other timeout, such as a completion recheck, propagates unchanged and fails the run.
 */
class PageMutationTimeout extends Error {
  override name = 'PageMutationTimeout'
  constructor(readonly timeout: unknown) {
    super('Search retirement page mutation timed out', { cause: timeout })
  }
}

async function pageMutation<T>(statement: PromiseLike<T>): Promise<T> {
  try {
    return await statement
  } catch (error) {
    if (getPostgresCancellationReason(error) === 'statement_timeout') {
      throw new PageMutationTimeout(error)
    }
    throw error
  }
}

function halve(rowLimit: number): number {
  return Math.max(ROW_LIMIT.min, Math.floor(rowLimit / 2))
}

interface Progress {
  knowledge_base_id: string
  phase: Phase
  after_id: string
}

/**
 * Retires a frozen set of legacy Search KBs after the move to live Search. Each page commits with its
 * durable cursor. Other KBs are traversed without modification. The runner owns bookkeeping, as it
 * owns `script_migrations`. Runs to completion; the registered successor runs it in budgeted slices.
 */
export const retireSearchEmbeddingsMigration: ScriptMigration = {
  name: '0027_retire_search_embeddings',
  async up(sql) {
    if ((await retireSearchEmbeddings(sql)) === 'deferred') {
      throw new ScriptMigrationDeferred('Another Search retirement runner holds the lock')
    }
  },
}

/**
 * Advances the retirement until it completes or `deadline` passes, throttled on the database's
 * commit latency, WAL rate and replication lag. Resumes the saved cursor; safe to interrupt at any
 * point, since each page commits its mutation together with the cursor.
 */
export async function retireSearchEmbeddings(
  sql: Sql,
  options: RetirementRunOptions = {}
): Promise<RetirementOutcome> {
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY
  const throttle = { ...DEFAULT_RETIREMENT_THROTTLE, ...options.throttle }
  const [{ locked }] =
    await sql`SELECT pg_try_advisory_lock(hashtextextended(${RETIREMENT_LOCK}, 0)) AS locked`
  if (!locked) {
    logger.info('Another Search retirement runner is active; deferring')
    return 'deferred'
  }
  try {
    if (!(await prepareTargets(sql))) return 'complete'
    return await retireTargets(sql, deadline, throttle)
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtextextended(${RETIREMENT_LOCK}, 0))`
  }
}

/** Captures the target snapshot once and reports whether any target remains. */
async function prepareTargets(sql: Sql): Promise<boolean> {
  return sql.begin('isolation level repeatable read', async (tx) => {
    await tx`SET LOCAL statement_timeout = '120s'`
    await tx`SET LOCAL lock_timeout = '1s'`
    await tx`CREATE TABLE IF NOT EXISTS search_embedding_cleanup_progress (
        id integer PRIMARY KEY CHECK (id = 1), knowledge_base_id text NOT NULL,
        phase text NOT NULL CHECK (phase IN ('documents', 'embeddings', 'done')),
        after_id text NOT NULL
      )`
    const [existing] = await tx<Progress[]>`
      SELECT knowledge_base_id, phase, after_id FROM search_embedding_cleanup_progress WHERE id = 1 FOR UPDATE`
    const [snapshot] = await tx`SELECT to_regclass('search_embedding_cleanup_targets') AS relation`
    if (snapshot.relation) return Boolean(existing)
    if (existing && existing.phase !== 'done') {
      const [target] = await tx`SELECT id FROM knowledge_base
        WHERE id = ${existing.knowledge_base_id} AND is_search_index FOR SHARE`
      if (!target) throw new Error('Cleanup target is no longer a Search knowledge base')
    }

    /** Creating the snapshot and resetting a legacy cursor commit atomically, once. */
    await tx`CREATE TABLE search_embedding_cleanup_targets (knowledge_base_id text PRIMARY KEY)`
    let afterId = ''
    for (;;) {
      const [page] = await tx<{ after_id: string | null }[]>`
        WITH targets AS (
          INSERT INTO search_embedding_cleanup_targets (knowledge_base_id)
          SELECT id FROM knowledge_base WHERE is_search_index AND id > ${afterId}
          ORDER BY id LIMIT ${SCAN_PAGE_SIZE}
          RETURNING knowledge_base_id
        ) SELECT max(knowledge_base_id) AS after_id FROM targets`
      if (page.after_id === null) break
      afterId = page.after_id
    }
    const [first] = await tx<{ knowledge_base_id: string }[]>`
      SELECT knowledge_base_id FROM search_embedding_cleanup_targets ORDER BY knowledge_base_id LIMIT 1`
    if (!first) return false
    await tx`ANALYZE search_embedding_cleanup_targets`
    await tx`ALTER TABLE search_embedding_cleanup_progress
      ADD COLUMN IF NOT EXISTS reindexed_through text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS vacuumed_tables integer NOT NULL DEFAULT 0`
    await tx`INSERT INTO search_embedding_cleanup_progress (id, knowledge_base_id, phase, after_id)
      VALUES (1, ${first.knowledge_base_id}, 'documents', '')
      ON CONFLICT (id) DO UPDATE SET knowledge_base_id = EXCLUDED.knowledge_base_id,
        phase = 'documents', after_id = '',
        reindexed_through = '', vacuumed_tables = 0`
    return true
  })
}

async function retireTargets(
  sql: Sql,
  deadline: number,
  throttle: RetirementThrottle
): Promise<RetirementOutcome> {
  const walBytesPerMs = await walBudgetBytesPerMs(sql, throttle.walBudgetShare)
  const startedAt = Date.now()
  let batches = 0
  let mutated = 0
  let rowLimit: number = ROW_LIMIT.initial
  /** The largest limit the run may still try: half of the smallest limit that timed out. */
  let ceiling: number = ROW_LIMIT.max
  /** Consecutive slow commits or lagging-replica checks; each doubles the back-off. */
  let strain = 0
  const backoffMs = () => Math.min(throttle.maxPauseMs, throttle.backoffMs * 2 ** (strain - 1))
  const pause = (ms: number) => sleep(Math.max(0, Math.min(ms, deadline - performance.now())))

  for (;;) {
    if (performance.now() >= deadline) {
      logger.info('Search retirement budget spent; deferring', { batches, mutated, rowLimit })
      return 'deferred'
    }
    const health = await readHealth(sql)
    if (health.replicaLagMs !== null && health.replicaLagMs > throttle.maxReplicaLagMs) {
      strain++
      const pauseMs = backoffMs()
      logger.warn('Search retirement batch', {
        throttle: 'replica_lag',
        replicaLagMs: Math.round(health.replicaLagMs),
        pauseMs,
        rowLimit,
      })
      await pause(pauseMs)
      continue
    }

    /** Timed around the whole call, so the synchronous-replication wait at commit counts. */
    const pageStartedAt = performance.now()
    let page: PageResult
    try {
      page = await retirePage(sql, rowLimit)
    } catch (error) {
      if (!(error instanceof PageMutationTimeout)) throw error
      /** The timed-out page rolled back with its cursor, so it is retried with fewer rows. */
      if (rowLimit <= ROW_LIMIT.min) throw error.timeout
      ceiling = halve(rowLimit)
      rowLimit = ceiling
      const pauseMs = Math.min(
        throttle.maxPauseMs,
        (performance.now() - pageStartedAt) * throttle.dutyRatio
      )
      logger.warn('Search retirement page timed out; retrying with fewer rows', {
        rowLimit,
        pauseMs: Math.round(pauseMs),
      })
      await pause(pauseMs)
      continue
    }
    if (page.done) break
    const pageMs = performance.now() - pageStartedAt
    const walBytes = await walSince(sql, health.lsn)
    batches++
    mutated += page.mutated

    let state: 'steady' | 'slow_commit' | 'slow_page' | 'phase_change' = 'steady'
    if (page.transition) {
      /** A phase change may include a full recheck, which says nothing about page cost. */
      state = 'phase_change'
      logger.info('Search retirement phase changed', {
        transition: page.transition,
        batches,
        mutated,
      })
    } else if (page.commitMs > throttle.slowCommitMs) {
      state = 'slow_commit'
      strain++
      rowLimit = halve(rowLimit)
    } else {
      strain = 0
      if (pageMs > SLOW_PAGE_MS) {
        state = 'slow_page'
        rowLimit = halve(rowLimit)
      } else if (pageMs < FAST_PAGE_MS) {
        rowLimit = Math.min(ceiling, rowLimit * 2)
      }
    }

    const dutyPauseMs = pageMs * throttle.dutyRatio
    /** Long enough that the WAL written during the page, spread over page and pause, fits the budget. */
    const walPauseMs = walBytes / walBytesPerMs - pageMs
    const strainPauseMs = state === 'slow_commit' ? backoffMs() : 0
    const pauseMs = Math.max(
      0,
      Math.min(throttle.maxPauseMs, Math.max(dutyPauseMs, walPauseMs, strainPauseMs))
    )
    const limitedBy =
      strainPauseMs >= Math.max(dutyPauseMs, walPauseMs) && strainPauseMs > 0
        ? 'backoff'
        : walPauseMs > dutyPauseMs
          ? 'wal'
          : 'duty'
    logger.info('Search retirement batch', {
      phase: page.phase,
      rows: page.mutated,
      pageMs: Math.round(pageMs),
      commitMs: Math.round(page.commitMs),
      walBytes,
      pauseMs: Math.round(pauseMs),
      throttle: state === 'steady' ? limitedBy : state,
      rowLimit,
    })
    if (batches % 10 === 0) {
      logger.info('Search embedding retirement progress', {
        batches,
        phase: page.phase,
        afterId: page.afterId,
        mutated,
        rowLimit,
        elapsedMs: Date.now() - startedAt,
      })
    }
    await pause(pauseMs)
  }
  logger.info('Selected Search knowledge bases retired', {
    batches,
    mutated,
    elapsedMs: Date.now() - startedAt,
  })
  return 'complete'
}

/**
 * The WAL rate the budget allows, in bytes per millisecond: a share of the WAL that may accumulate
 * within one checkpoint interval before `max_wal_size` forces an early checkpoint.
 */
async function walBudgetBytesPerMs(sql: Sql, share: number): Promise<number> {
  const [settings] = await sql<{ max_wal_bytes: number; checkpoint_ms: number }[]>`
    SELECT pg_size_bytes(current_setting('max_wal_size'))::float8 AS max_wal_bytes,
      (extract(epoch FROM current_setting('checkpoint_timeout')::interval) * 1000)::float8 AS checkpoint_ms`
  return (share * settings.max_wal_bytes) / settings.checkpoint_ms
}

interface Health {
  lsn: string
  /** The worst replica's lag, or null without replicas or without `pg_read_all_stats`. */
  replicaLagMs: number | null
}

async function readHealth(sql: Sql): Promise<Health> {
  const [health] = await sql<{ lsn: string; replica_lag_ms: number | null }[]>`
    SELECT pg_current_wal_lsn()::text AS lsn,
      (SELECT extract(epoch FROM max(greatest(write_lag, flush_lag, replay_lag))) * 1000
       FROM pg_stat_replication)::float8 AS replica_lag_ms`
  return { lsn: health.lsn, replicaLagMs: health.replica_lag_ms }
}

/** WAL the whole database wrote since `lsn`, every writer included. */
async function walSince(sql: Sql, lsn: string): Promise<number> {
  const [row] = await sql<{ bytes: number }[]>`
    SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), ${lsn}::pg_lsn)::float8 AS bytes`
  return row.bytes
}

/**
 * Retires one page: the target rows among the next `rowLimit * SCAN_ROWS_PER_MUTATION` IDs (at
 * most `SCAN_PAGE_SIZE`), capped at `rowLimit`.
 * A capped page advances the cursor only to its last mutated row, so the rest of the scan is
 * read again by the next page; an uncapped page advances past its whole scan.
 */
async function retirePage(sql: Sql, rowLimit: number): Promise<PageResult> {
  return retryOnLockTimeout(
    async () => {
      let statementsDoneAt = 0
      const page = await sql.begin(async (tx) => {
        const result = await retirePageStatements(tx, rowLimit)
        statementsDoneAt = performance.now()
        return result
      })
      return { ...page, commitMs: performance.now() - statementsDoneAt }
    },
    {
      budgetMs: LOCK_RETRY_BUDGET_MS,
      backoff: { baseMs: 1_000, maxMs: 5_000 },
      onRetry: ({ attempt, delayMs }) =>
        logger.warn('Search retirement page locked; retrying', {
          attempt,
          retryInMs: Math.round(delayMs),
        }),
    }
  )
}

async function retirePageStatements(
  tx: TransactionSql,
  rowLimit: number
): Promise<Omit<PageResult, 'commitMs'>> {
  const scanLimit = Math.min(SCAN_PAGE_SIZE, rowLimit * SCAN_ROWS_PER_MUTATION)
  await tx`SET LOCAL statement_timeout = '120s'`
  await tx`SET LOCAL lock_timeout = '1s'`
  const [progress] = await tx<Progress[]>`
          SELECT knowledge_base_id, phase, after_id FROM search_embedding_cleanup_progress WHERE id = 1 FOR UPDATE`
  const result = (
    page: Partial<Omit<PageResult, 'commitMs'>> = {}
  ): Omit<PageResult, 'commitMs'> => ({
    done: false,
    phase: progress.phase,
    afterId: progress.after_id,
    mutated: 0,
    ...page,
  })
  if (progress.phase === 'done') {
    /** A retry after maintenance failed rechecks every captured KB, as completion did. */
    await tx`SET LOCAL statement_timeout = '30min'`
    await validateTargetMarkers(tx)
    return result({ done: true })
  }

  if (progress.phase === 'documents') {
    /** Already-retired documents are skipped so they never spend the row limit. */
    const [page] = await pageMutation(tx<
      { after_id: string; mutated: number; invalid_target: boolean }[]
    >`
            WITH source_page AS MATERIALIZED (
              SELECT id, knowledge_base_id,
                (NOT user_excluded OR enabled OR processing_queue_token IS NOT NULL
                 OR processing_queued_at IS NOT NULL OR processing_deferred_until IS NOT NULL) AS unretired
              FROM document WHERE id > ${progress.after_id} ORDER BY id LIMIT ${scanLimit}
            ), target_page AS MATERIALIZED (
              SELECT p.id, p.knowledge_base_id FROM source_page p
              JOIN search_embedding_cleanup_targets t ON t.knowledge_base_id = p.knowledge_base_id
              WHERE p.unretired ORDER BY p.id LIMIT ${rowLimit}
            ), page_end AS MATERIALIZED (
              SELECT count(*) >= ${rowLimit} AS limited, max(id) AS last_target FROM target_page
            ), locked_targets AS MATERIALIZED (
              SELECT kb.id, kb.is_search_index FROM knowledge_base kb
              WHERE kb.id IN (SELECT knowledge_base_id FROM target_page)
              ORDER BY kb.id FOR SHARE OF kb
            ), invalid_target AS MATERIALIZED (
              SELECT p.id FROM target_page p
              LEFT JOIN locked_targets kb ON kb.id = p.knowledge_base_id
              WHERE kb.id IS NULL OR NOT kb.is_search_index LIMIT 1
            ), retired AS (
              UPDATE document d
              SET user_excluded = true, enabled = false, processing_queue_token = NULL,
                  processing_queued_at = NULL, processing_deferred_until = NULL
              FROM target_page p
              WHERE d.id = p.id AND d.knowledge_base_id = p.knowledge_base_id
                AND NOT EXISTS (SELECT 1 FROM invalid_target)
                AND (NOT d.user_excluded OR d.enabled OR d.processing_queue_token IS NOT NULL
                     OR d.processing_queued_at IS NOT NULL OR d.processing_deferred_until IS NOT NULL)
              RETURNING d.id
            ) SELECT CASE WHEN e.limited THEN e.last_target ELSE max(p.id) END AS after_id,
                (SELECT count(*) FROM retired)::int AS mutated,
                EXISTS (SELECT 1 FROM invalid_target) AS invalid_target
              FROM source_page p CROSS JOIN page_end e GROUP BY e.limited, e.last_target`)
    if (!page) {
      await tx`UPDATE search_embedding_cleanup_progress SET phase = 'embeddings', after_id = '' WHERE id = 1`
      return result({ afterId: '', transition: 'embeddings' })
    }
    if (page.invalid_target) throw new Error('Cleanup target is no longer a Search knowledge base')
    await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${page.after_id} WHERE id = 1`
    return result({ afterId: page.after_id, mutated: page.mutated })
  }

  /** Keep page IDs in PostgreSQL; foreign keys cascade projection and provenance deletes. */
  const [page] = await pageMutation(tx<
    {
      after_id: string
      mutated: number
      unretired: boolean
      invalid_target: boolean
    }[]
  >`
          WITH source_page AS MATERIALIZED (
            SELECT id, knowledge_base_id, document_id FROM embedding WHERE id > ${progress.after_id} ORDER BY id LIMIT ${scanLimit}
          ), target_page AS MATERIALIZED (
            SELECT p.* FROM source_page p
            JOIN search_embedding_cleanup_targets t ON t.knowledge_base_id = p.knowledge_base_id
            ORDER BY p.id LIMIT ${rowLimit}
          ), page_end AS MATERIALIZED (
            SELECT count(*) >= ${rowLimit} AS limited, max(id) AS last_target FROM target_page
          ), locked_targets AS MATERIALIZED (
            SELECT kb.id, kb.is_search_index FROM knowledge_base kb
            WHERE kb.id IN (SELECT knowledge_base_id FROM target_page)
            ORDER BY kb.id FOR SHARE OF kb
          ), invalid_target AS MATERIALIZED (
            SELECT p.id FROM target_page p
            LEFT JOIN locked_targets kb ON kb.id = p.knowledge_base_id
            WHERE kb.id IS NULL OR NOT kb.is_search_index LIMIT 1
          ), unretired AS MATERIALIZED (
            SELECT p.id FROM target_page p
            JOIN document d ON d.id = p.document_id
            WHERE NOT d.user_excluded OR d.knowledge_base_id <> p.knowledge_base_id LIMIT 1
          ), deleted AS (
            DELETE FROM embedding e USING target_page p
            WHERE e.id = p.id AND e.knowledge_base_id = p.knowledge_base_id
              AND NOT EXISTS (SELECT 1 FROM unretired) AND NOT EXISTS (SELECT 1 FROM invalid_target)
            RETURNING e.id
          ) SELECT CASE WHEN e.limited THEN e.last_target ELSE max(p.id) END AS after_id,
              (SELECT count(*) FROM deleted)::int AS mutated,
              EXISTS (SELECT 1 FROM unretired) AS unretired,
              EXISTS (SELECT 1 FROM invalid_target) AS invalid_target
            FROM source_page p CROSS JOIN page_end e GROUP BY e.limited, e.last_target`)
  if (page?.invalid_target) throw new Error('Cleanup target is no longer a Search knowledge base')
  if (page?.unretired)
    throw new Error('Search content changed after retirement; stop writers before resuming')
  if (!page) {
    /**
     * A late insert may sort behind either UUID cursor; completion must recheck the target.
     * These rechecks walk every captured KB once, which no single page does.
     */
    await tx`SET LOCAL statement_timeout = '30min'`
    logger.info('Rechecking captured Search knowledge bases before completion')
    const [unretired] = await tx`SELECT d.id FROM document d
              JOIN search_embedding_cleanup_targets t ON t.knowledge_base_id = d.knowledge_base_id
              WHERE (NOT user_excluded OR enabled OR processing_queue_token IS NOT NULL
                   OR processing_queued_at IS NOT NULL OR processing_deferred_until IS NOT NULL) LIMIT 1`
    if (unretired) {
      await tx`UPDATE search_embedding_cleanup_progress SET phase = 'documents', after_id = '' WHERE id = 1`
      return result({ afterId: '', transition: 'documents_rescan' })
    }
    const [remaining] = await tx`SELECT e.id FROM embedding e
              JOIN search_embedding_cleanup_targets t ON t.knowledge_base_id = e.knowledge_base_id LIMIT 1`
    if (remaining) {
      await tx`UPDATE search_embedding_cleanup_progress SET after_id = '' WHERE id = 1`
      return result({ afterId: '', transition: 'embeddings_rescan' })
    }
    await validateTargetMarkers(tx)
    await tx`UPDATE search_embedding_cleanup_progress SET phase = 'done' WHERE id = 1`
    return result({ done: true })
  }
  await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${page.after_id} WHERE id = 1`
  return result({ afterId: page.after_id, mutated: page.mutated })
}

/** Validate even empty or fully scanned KBs, holding marker locks until completion commits. */
async function validateTargetMarkers(tx: TransactionSql): Promise<void> {
  let afterId = ''
  for (;;) {
    const [page] = await tx<{ after_id: string | null; invalid_target: boolean }[]>`
      WITH target_page AS MATERIALIZED (
        SELECT knowledge_base_id FROM search_embedding_cleanup_targets
        WHERE knowledge_base_id > ${afterId} ORDER BY knowledge_base_id LIMIT ${SCAN_PAGE_SIZE}
      ), locked_targets AS MATERIALIZED (
        SELECT kb.id, kb.is_search_index FROM knowledge_base kb
        WHERE kb.id IN (SELECT knowledge_base_id FROM target_page)
        ORDER BY kb.id FOR SHARE OF kb
      ) SELECT max(p.knowledge_base_id) AS after_id,
          coalesce(bool_or(kb.id IS NULL OR NOT kb.is_search_index), false) AS invalid_target
        FROM target_page p LEFT JOIN locked_targets kb ON kb.id = p.knowledge_base_id`
    if (page.invalid_target) throw new Error('Cleanup target is no longer a Search knowledge base')
    if (page.after_id === null) return
    afterId = page.after_id
  }
}
