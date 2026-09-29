import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import { type ScriptMigration, ScriptMigrationDeferred } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('RetireSearchEmbeddings')
const BATCH_SIZE = 500
const MAX_BATCHES = 100
const RUN_BUDGET_MS = 60_000

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
    await sql`CREATE TABLE IF NOT EXISTS search_embedding_cleanup_progress (
      id integer PRIMARY KEY CHECK (id = 1), knowledge_base_id text NOT NULL,
      phase text NOT NULL CHECK (phase IN ('documents', 'embeddings', 'done')),
      after_id text NOT NULL
    )`
    const existing = await sql<
      Progress[]
    >`SELECT * FROM search_embedding_cleanup_progress WHERE id = 1`
    if (existing.length === 0) {
      const targets = await sql<{ id: string }[]>`
        SELECT id FROM knowledge_base WHERE is_search_index LIMIT 2`
      if (targets.length === 0) return
      if (targets.length > 1) {
        throw new ScriptMigrationDeferred(
          'Multiple Search knowledge bases found; cleanup target is ambiguous'
        )
      }
      await sql`INSERT INTO search_embedding_cleanup_progress VALUES (1, ${targets[0].id}, 'documents', '')
        ON CONFLICT (id) DO NOTHING`
    }
    const [progress] = await sql<
      Progress[]
    >`SELECT * FROM search_embedding_cleanup_progress WHERE id = 1`
    const knowledgeBaseId = progress.knowledge_base_id

    const deadline = Date.now() + RUN_BUDGET_MS
    for (let batch = 0; batch < MAX_BATCHES && Date.now() < deadline; batch++) {
      if (await retirePage(sql, knowledgeBaseId)) {
        logger.info('Selected Search knowledge base embeddings retired')
        return
      }
      await sleep(100)
    }
    throw new ScriptMigrationDeferred(
      'Cleanup page budget reached; rerun to resume the saved cursor'
    )
  },
}

async function retirePage(sql: Sql, knowledgeBaseId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '15s'`
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
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM document WHERE id > ${progress.after_id} ORDER BY id LIMIT ${BATCH_SIZE}`
      if (rows.length === 0) {
        await tx`UPDATE search_embedding_cleanup_progress SET phase = 'embeddings', after_id = '' WHERE id = 1`
        return false
      }
      await tx`UPDATE document
        SET user_excluded = true, enabled = false, processing_queue_token = NULL,
            processing_queued_at = NULL, processing_deferred_until = NULL
        WHERE id IN ${tx(rows.map((row) => row.id))} AND knowledge_base_id = ${knowledgeBaseId}
          AND (NOT user_excluded OR enabled OR processing_queue_token IS NOT NULL
               OR processing_queued_at IS NOT NULL OR processing_deferred_until IS NOT NULL)`
      await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${rows[rows.length - 1].id} WHERE id = 1`
      return false
    }

    const rows = await tx<{ id: string }[]>`
      SELECT id FROM embedding WHERE id > ${progress.after_id} ORDER BY id LIMIT ${BATCH_SIZE}`
    if (rows.length === 0) {
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
    const ids = rows.map((row) => row.id)
    const [unretired] = await tx`
      SELECT e.id FROM embedding e JOIN document d ON d.id = e.document_id
      WHERE e.id IN ${tx(ids)} AND e.knowledge_base_id = ${knowledgeBaseId}
        AND (NOT d.user_excluded OR d.knowledge_base_id <> e.knowledge_base_id) LIMIT 1`
    if (unretired)
      throw new Error('Search content changed after retirement; stop writers before resuming')
    /** Foreign keys cascade to vector/keyword projections and private chunk provenance. */
    await tx`DELETE FROM embedding WHERE id IN ${tx(ids)} AND knowledge_base_id = ${knowledgeBaseId}`
    await tx`UPDATE search_embedding_cleanup_progress SET after_id = ${rows[rows.length - 1].id} WHERE id = 1`
    return false
  })
}

/** The standalone entry uses the deployment journal and leaves budget-deferred work unrecorded. */
if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required for Search retirement')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    const { runScriptMigrations } = await import('@sim/db/script-migrations/index')
    await runScriptMigrations(sql, [retireSearchEmbeddingsMigration])
  } finally {
    await sql.end()
  }
}
