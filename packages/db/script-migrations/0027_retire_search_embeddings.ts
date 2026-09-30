import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { createLogger } from '@sim/logger'
import { getPostgresCancellationReason } from '@sim/utils/errors'
import postgres, { type Sql, type TransactionSql } from 'postgres'

const logger = createLogger('RetireSearchEmbeddings')
/** IDs one page reads in primary-key order; reading is cheap next to the mutation. */
const SCAN_PAGE_SIZE = 25_000
/**
 * Rows one page may update or delete. Every retired document is a non-HOT update touching each of
 * its indexes, and every deleted chunk cascades into its projections, so the write cost of a page,
 * not its scan, is what can outrun the statement timeout.
 */
const ROW_LIMIT = { initial: 2_000, min: 25, max: SCAN_PAGE_SIZE } as const
/** A page slower than this halves the row limit; one well under it with a full limit doubles it. */
const TARGET_PAGE_MS = 30_000
const LOCK_RETRY_BUDGET_MS = 60_000

interface PageResult {
  done: boolean
  /** The page stopped at the row limit rather than the end of its scan. */
  limited: boolean
  elapsedMs: number
}

interface Progress {
  knowledge_base_id: string
  phase: 'documents' | 'embeddings' | 'done'
  after_id: string
}

/**
 * Retires a frozen set of legacy Search KBs after the move to live Search. Each page commits with its
 * durable cursor. Other KBs are traversed without modification. The runner owns bookkeeping, as it owns `script_migrations`.
 */
export const retireSearchEmbeddingsMigration: ScriptMigration = {
  name: '0027_retire_search_embeddings',
  async up(sql) {
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
      const [snapshot] =
        await tx`SELECT to_regclass('search_embedding_cleanup_targets') AS relation`
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
    let rowLimit: number = ROW_LIMIT.initial
    for (;;) {
      let page: PageResult
      try {
        page = await retirePage(sql, rowLimit)
      } catch (error) {
        /** The timed-out page rolled back with its cursor, so it is retried with fewer rows. */
        if (getPostgresCancellationReason(error) !== 'statement_timeout') throw error
        if (rowLimit <= ROW_LIMIT.min) throw error
        rowLimit = Math.max(ROW_LIMIT.min, Math.floor(rowLimit / 2))
        logger.warn('Search retirement page timed out; retrying with fewer rows', { rowLimit })
        continue
      }
      if (page.done) break
      batches++
      if (page.elapsedMs > TARGET_PAGE_MS) {
        rowLimit = Math.max(ROW_LIMIT.min, Math.floor(rowLimit / 2))
      } else if (page.limited && page.elapsedMs < TARGET_PAGE_MS / 4) {
        rowLimit = Math.min(ROW_LIMIT.max, rowLimit * 2)
      }
      if (batches % 10 === 0) {
        logger.info('Search embedding retirement progress', {
          batches,
          rowLimit,
          elapsedMs: Date.now() - startedAt,
        })
      }
    }
    logger.info('Selected Search knowledge bases retired', {
      batches,
      elapsedMs: Date.now() - startedAt,
    })
  },
}

/**
 * Retires one page: the target rows among the next `SCAN_PAGE_SIZE` IDs, capped at `rowLimit`.
 * A capped page advances the cursor only to its last mutated row, so the rest of the scan is
 * read again by the next page; an uncapped page advances past its whole scan.
 */
async function retirePage(sql: Sql, rowLimit: number): Promise<PageResult> {
  return retryOnLockTimeout(
    () =>
      sql.begin(async (tx) => {
        const startedAt = performance.now()
        const result = (done: boolean, limited = false): PageResult => ({
          done,
          limited,
          elapsedMs: performance.now() - startedAt,
        })
        await tx`SET LOCAL statement_timeout = '120s'`
        await tx`SET LOCAL lock_timeout = '1s'`
        const [progress] = await tx<Progress[]>`
          SELECT knowledge_base_id, phase, after_id FROM search_embedding_cleanup_progress WHERE id = 1 FOR UPDATE`
        if (progress.phase === 'done') {
          await validateTargetMarkers(tx)
          return result(true)
        }

        if (progress.phase === 'documents') {
          /** Already-retired documents are skipped so they never spend the row limit. */
          const [page] = await tx<
            { after_id: string; limited: boolean; invalid_target: boolean }[]
          >`
            WITH source_page AS MATERIALIZED (
              SELECT id, knowledge_base_id,
                (NOT user_excluded OR enabled OR processing_queue_token IS NOT NULL
                 OR processing_queued_at IS NOT NULL OR processing_deferred_until IS NOT NULL) AS unretired
              FROM document WHERE id > ${progress.after_id} ORDER BY id LIMIT ${SCAN_PAGE_SIZE}
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
            ) SELECT CASE WHEN e.limited THEN e.last_target ELSE max(p.id) END AS after_id,
                e.limited, EXISTS (SELECT 1 FROM invalid_target) AS invalid_target
              FROM source_page p CROSS JOIN page_end e GROUP BY e.limited, e.last_target`
          if (!page) {
            await tx`UPDATE search_embedding_cleanup_progress SET phase = 'embeddings', after_id = '' WHERE id = 1`
            return result(false)
          }
          if (page.invalid_target)
            throw new Error('Cleanup target is no longer a Search knowledge base')
          await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${page.after_id} WHERE id = 1`
          return result(false, page.limited)
        }

        /** Keep page IDs in PostgreSQL; foreign keys cascade projection and provenance deletes. */
        const [page] = await tx<
          { after_id: string; limited: boolean; unretired: boolean; invalid_target: boolean }[]
        >`
          WITH source_page AS MATERIALIZED (
            SELECT id, knowledge_base_id, document_id FROM embedding WHERE id > ${progress.after_id} ORDER BY id LIMIT ${SCAN_PAGE_SIZE}
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
          ) SELECT CASE WHEN e.limited THEN e.last_target ELSE max(p.id) END AS after_id,
              e.limited, EXISTS (SELECT 1 FROM unretired) AS unretired,
              EXISTS (SELECT 1 FROM invalid_target) AS invalid_target
            FROM source_page p CROSS JOIN page_end e GROUP BY e.limited, e.last_target`
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
          const [unretired] = await tx`SELECT d.id FROM document d
              JOIN search_embedding_cleanup_targets t ON t.knowledge_base_id = d.knowledge_base_id
              WHERE (NOT user_excluded OR enabled OR processing_queue_token IS NOT NULL
                   OR processing_queued_at IS NOT NULL OR processing_deferred_until IS NOT NULL) LIMIT 1`
          if (unretired) {
            await tx`UPDATE search_embedding_cleanup_progress SET phase = 'documents', after_id = '' WHERE id = 1`
            return result(false)
          }
          const [remaining] = await tx`SELECT e.id FROM embedding e
              JOIN search_embedding_cleanup_targets t ON t.knowledge_base_id = e.knowledge_base_id LIMIT 1`
          if (remaining) {
            await tx`UPDATE search_embedding_cleanup_progress SET after_id = '' WHERE id = 1`
            return result(false)
          }
          await validateTargetMarkers(tx)
          await tx`UPDATE search_embedding_cleanup_progress SET phase = 'done' WHERE id = 1`
          return result(true)
        }
        await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${page.after_id} WHERE id = 1`
        return result(false, page.limited)
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

/** The standalone entry resumes the deployment cursor and journals only a completed retirement. */
if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required for Search retirement')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    const { runScriptMigrations } = await import('@sim/db/script-migrations/index')
    const { retireAllSearchEmbeddingsMigration } = await import(
      '@sim/db/script-migrations/0029_retire_all_search_embeddings'
    )
    await runScriptMigrations(sql, [retireAllSearchEmbeddingsMigration])
  } finally {
    await sql.end()
  }
}
