import type { ScriptMigration } from '@sim/db/script-migrations/types'
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
 * not its scan, is what can outrun the statement timeout. `maxRows` lowers the starting limit and
 * the ceiling it may grow to.
 */
const ROW_LIMIT = { initial: 2_000, min: 25, max: 8_000 } as const
/** A page slower than this halves the row limit. */
const SLOW_PAGE_MS = 30_000
/**
 * A page faster than this doubles the row limit, widening its scan window with it, but never back
 * to a size that timed out.
 */
const FAST_PAGE_MS = SLOW_PAGE_MS / 4
/** The longest pause after one page, however slow the page was. */
const MAX_PAGE_PAUSE_MS = 60_000
const LOCK_RETRY_BUDGET_MS = 60_000

/**
 * How hard one run pushes the primary. Each page, committed or timed out, is followed by a pause of
 * `pauseRatio` times the page's duration (up to a minute), so the run is busy at most
 * `1 / (1 + pauseRatio)` of the time. A page is timed through its commit, so a slow synchronous
 * replica or a checkpoint stall lengthens the pause by the same factor.
 */
export interface RetirementPacing {
  pauseRatio: number
  /** The most rows one page may update or delete, from 25 to 8,000. */
  maxRows: number
}

export const DEFAULT_RETIREMENT_PACING: RetirementPacing = { pauseRatio: 2, maxRows: 2_000 }

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
 * durable cursor. Other KBs are traversed without modification. The runner owns bookkeeping, as it owns `script_migrations`.
 */
export const retireSearchEmbeddingsMigration: ScriptMigration = {
  name: '0027_retire_search_embeddings',
  up: (sql) => retireSearchEmbeddings(sql),
}

/** Retires every captured target, resuming the saved cursor, paced by `pacing`. */
export async function retireSearchEmbeddings(
  sql: Sql,
  pacing: RetirementPacing = DEFAULT_RETIREMENT_PACING
): Promise<void> {
  if (
    !(pacing.pauseRatio >= 0) ||
    !Number.isInteger(pacing.maxRows) ||
    pacing.maxRows < ROW_LIMIT.min ||
    pacing.maxRows > ROW_LIMIT.max
  ) {
    throw new Error(
      `Search retirement pacing needs a pause ratio of at least 0 and ${ROW_LIMIT.min}-${ROW_LIMIT.max} max rows`
    )
  }
  const pause = (pageMs: number) => sleep(Math.min(pageMs * pacing.pauseRatio, MAX_PAGE_PAUSE_MS))
  const hasTargets = await sql.begin('isolation level repeatable read', async (tx) => {
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
  if (!hasTargets) return

  const startedAt = Date.now()
  let batches = 0
  let mutated = 0
  let rowLimit = Math.min(ROW_LIMIT.initial, pacing.maxRows)
  /** The largest limit the run may still try: half of the smallest limit that timed out. */
  let ceiling = pacing.maxRows
  for (;;) {
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
      logger.warn('Search retirement page timed out; retrying with fewer rows', { rowLimit })
      await pause(performance.now() - pageStartedAt)
      continue
    }
    if (page.done) break
    const pageMs = performance.now() - pageStartedAt
    batches++
    mutated += page.mutated
    if (page.transition) {
      /** A phase change may include a full recheck, which says nothing about page cost. */
      logger.info('Search retirement phase changed', {
        transition: page.transition,
        batches,
        mutated,
      })
    } else if (pageMs > SLOW_PAGE_MS) {
      rowLimit = halve(rowLimit)
      logger.warn('Search retirement page was slow; halving the row limit', {
        pageMs: Math.round(pageMs),
        rowLimit,
      })
    } else if (pageMs < FAST_PAGE_MS) {
      rowLimit = Math.min(ceiling, rowLimit * 2)
    }
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
    await pause(pageMs)
  }
  logger.info('Selected Search knowledge bases retired', {
    batches,
    mutated,
    elapsedMs: Date.now() - startedAt,
  })
}

/**
 * Retires one page: the target rows among the next `rowLimit * SCAN_ROWS_PER_MUTATION` IDs (at
 * most `SCAN_PAGE_SIZE`), capped at `rowLimit`.
 * A capped page advances the cursor only to its last mutated row, so the rest of the scan is
 * read again by the next page; an uncapped page advances past its whole scan.
 */
async function retirePage(sql: Sql, rowLimit: number): Promise<PageResult> {
  return retryOnLockTimeout(
    () =>
      sql.begin(async (tx) => {
        const scanLimit = Math.min(SCAN_PAGE_SIZE, rowLimit * SCAN_ROWS_PER_MUTATION)
        await tx`SET LOCAL statement_timeout = '120s'`
        await tx`SET LOCAL lock_timeout = '1s'`
        const [progress] = await tx<Progress[]>`
          SELECT knowledge_base_id, phase, after_id FROM search_embedding_cleanup_progress WHERE id = 1 FOR UPDATE`
        const result = (page: Partial<PageResult> = {}): PageResult => ({
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
          if (page.invalid_target)
            throw new Error('Cleanup target is no longer a Search knowledge base')
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
        if (page?.invalid_target)
          throw new Error('Cleanup target is no longer a Search knowledge base')
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
      }),
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

/** Historical implementation remains for migration replay tests; the unbounded CLI is retired. */
if (import.meta.main) {
  logger.error(
    'Use packages/db/scripts/retire-indexed-search.ts. The legacy delete/reindex command is disabled.'
  )
  process.exitCode = 1
}
