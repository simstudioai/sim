import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('RetireSearchEmbeddings')
const BATCH_SIZE = 25_000
const LOCK_RETRY_BUDGET_MS = 60_000

interface Progress {
  knowledge_base_id: string
  phase: 'documents' | 'embeddings' | 'done'
  after_id: string
}

/**
 * Retires the sole legacy Search KB after the move to live Search. Each page commits with its
 * durable cursor. Other KBs are traversed without modification. The runner owns bookkeeping, as it owns `script_migrations`.
 */
export const retireSearchEmbeddingsMigration: ScriptMigration = {
  name: '0027_retire_search_embeddings',
  async up(sql) {
    const knowledgeBaseId = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '120s'`
      await tx`SET LOCAL lock_timeout = '1s'`
      await tx`CREATE TABLE IF NOT EXISTS search_embedding_cleanup_progress (
          id integer PRIMARY KEY CHECK (id = 1), knowledge_base_id text NOT NULL,
          phase text NOT NULL CHECK (phase IN ('documents', 'embeddings', 'done')),
          after_id text NOT NULL
        )`
      const existing = await tx<
        Progress[]
      >`SELECT * FROM search_embedding_cleanup_progress WHERE id = 1`
      if (existing.length === 0) {
        const targets = await tx<{ id: string }[]>`
          SELECT id FROM knowledge_base WHERE is_search_index LIMIT 2`
        if (targets.length === 0) return null
        if (targets.length > 1) {
          throw new Error('Multiple Search knowledge bases found; cleanup target is ambiguous')
        }
        await tx`INSERT INTO search_embedding_cleanup_progress (id, knowledge_base_id, phase, after_id)
          VALUES (1, ${targets[0].id}, 'documents', '')
          ON CONFLICT (id) DO NOTHING`
      }
      const [progress] = await tx<
        Progress[]
      >`SELECT * FROM search_embedding_cleanup_progress WHERE id = 1`
      return progress.knowledge_base_id
    })
    if (knowledgeBaseId === null) return

    const startedAt = Date.now()
    let batches = 0
    while (!(await retirePage(sql, knowledgeBaseId))) {
      batches++
      if (batches % 10 === 0) {
        logger.info('Search embedding retirement progress', {
          batches,
          elapsedMs: Date.now() - startedAt,
        })
      }
    }
    logger.info('Selected Search knowledge base embeddings retired', {
      batches,
      elapsedMs: Date.now() - startedAt,
    })
  },
}

async function retirePage(sql: Sql, knowledgeBaseId: string): Promise<boolean> {
  return retryOnLockTimeout(
    () =>
      sql.begin(async (tx) => {
        await tx`SET LOCAL statement_timeout = '120s'`
        await tx`SET LOCAL lock_timeout = '1s'`
        const [progress] = await tx<Progress[]>`
          SELECT knowledge_base_id, phase, after_id FROM search_embedding_cleanup_progress WHERE id = 1 FOR UPDATE`
        if (progress.knowledge_base_id !== knowledgeBaseId) {
          throw new Error('Cannot change the selected Search KB during a cleanup')
        }
        const [target] = await tx`SELECT id FROM knowledge_base
          WHERE id = ${knowledgeBaseId} AND is_search_index FOR SHARE`
        if (!target) throw new Error('Cleanup target is no longer a Search knowledge base')
        if (progress.phase === 'done') return true

        if (progress.phase === 'documents') {
          const [page] = await tx<{ after_id: string | null }[]>`
            WITH source_page AS MATERIALIZED (
              SELECT id FROM document WHERE id > ${progress.after_id} ORDER BY id LIMIT ${BATCH_SIZE}
            ), retired AS (
              UPDATE document d
              SET user_excluded = true, enabled = false, processing_queue_token = NULL,
                  processing_queued_at = NULL, processing_deferred_until = NULL
              FROM source_page p WHERE d.id = p.id AND d.knowledge_base_id = ${knowledgeBaseId}
                AND (NOT d.user_excluded OR d.enabled OR d.processing_queue_token IS NOT NULL
                     OR d.processing_queued_at IS NOT NULL OR d.processing_deferred_until IS NOT NULL)
            ) SELECT max(id) AS after_id FROM source_page`
          if (page.after_id === null) {
            await tx`UPDATE search_embedding_cleanup_progress SET phase = 'embeddings', after_id = '' WHERE id = 1`
            return false
          }
          await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${page.after_id} WHERE id = 1`
          return false
        }

        /** Keep page IDs in PostgreSQL; foreign keys cascade projection and provenance deletes. */
        const [page] = await tx<{ after_id: string | null; unretired: boolean }[]>`
          WITH source_page AS MATERIALIZED (
            SELECT id FROM embedding WHERE id > ${progress.after_id} ORDER BY id LIMIT ${BATCH_SIZE}
          ), unretired AS MATERIALIZED (
            SELECT e.id FROM source_page p JOIN embedding e ON e.id = p.id
            JOIN document d ON d.id = e.document_id
            WHERE e.knowledge_base_id = ${knowledgeBaseId}
              AND (NOT d.user_excluded OR d.knowledge_base_id <> e.knowledge_base_id) LIMIT 1
          ), deleted AS (
            DELETE FROM embedding e USING source_page p
            WHERE e.id = p.id AND e.knowledge_base_id = ${knowledgeBaseId}
              AND NOT EXISTS (SELECT 1 FROM unretired)
          ) SELECT max(id) AS after_id, EXISTS (SELECT 1 FROM unretired) AS unretired FROM source_page`
        if (page.unretired)
          throw new Error('Search content changed after retirement; stop writers before resuming')
        if (page.after_id === null) {
          /** A late insert may sort behind either UUID cursor; completion must recheck the target. */
          const [unretired] =
            await tx`SELECT id FROM document WHERE knowledge_base_id = ${knowledgeBaseId}
              AND (NOT user_excluded OR enabled OR processing_queue_token IS NOT NULL
                   OR processing_queued_at IS NOT NULL OR processing_deferred_until IS NOT NULL) LIMIT 1`
          if (unretired) {
            await tx`UPDATE search_embedding_cleanup_progress SET phase = 'documents', after_id = '' WHERE id = 1`
            return false
          }
          const [remaining] =
            await tx`SELECT id FROM embedding WHERE knowledge_base_id = ${knowledgeBaseId} LIMIT 1`
          if (remaining) {
            await tx`UPDATE search_embedding_cleanup_progress SET after_id = '' WHERE id = 1`
            return false
          }
          await tx`UPDATE search_embedding_cleanup_progress SET phase = 'done' WHERE id = 1`
          return true
        }
        await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${page.after_id} WHERE id = 1`
        return false
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

/** The standalone entry resumes the deployment cursor and journals only a completed retirement. */
if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required for Search retirement')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    const { runScriptMigrations } = await import('@sim/db/script-migrations/index')
    const { maintainSearchRetirementMigration } = await import(
      '@sim/db/script-migrations/0028_maintain_search_retirement'
    )
    await runScriptMigrations(sql, [
      retireSearchEmbeddingsMigration,
      maintainSearchRetirementMigration,
    ])
  } finally {
    await sql.end()
  }
}
