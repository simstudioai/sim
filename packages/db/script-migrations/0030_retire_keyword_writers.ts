import { installKnowledgeProjectionMarking } from '@sim/db/script-migrations/0024_knowledge_projection_async'
import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('RetireKeywordWriters')

/** Stops retired keyword writes while keeping Tin's table available to draining detach workers. */
export async function retireKeywordWriters(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '100ms'")
    await tx.unsafe("SET LOCAL statement_timeout = '5s'")
    await tx.unsafe(`LOCK TABLE knowledge_base, embedding, document, embedding_keyword_tin
      IN SHARE ROW EXCLUSIVE MODE NOWAIT`)
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_keyword_search_sync ON embedding')
    await tx.unsafe('DROP TRIGGER IF EXISTS knowledge_base_keyword_search_sync ON knowledge_base')
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_keyword_tin_sync ON embedding')
    await tx.unsafe('DROP TRIGGER IF EXISTS knowledge_base_keyword_tin_sync ON knowledge_base')
    await tx.unsafe(
      'DROP TRIGGER IF EXISTS embedding_keyword_tin_source_acl_set ON embedding_keyword_tin'
    )
    await tx.unsafe(`DROP FUNCTION IF EXISTS sync_embedding_keyword_search(),
      sync_knowledge_base_keyword_search(), sync_embedding_keyword_tin(),
      sync_knowledge_base_keyword_tin(), knowledge_tin_membership_key(text),
      knowledge_tin_stream(tsvector), knowledge_tin_base_token(text) RESTRICT`)
    await installKnowledgeProjectionMarking(tx)
  })
}

export const retireKeywordWritersMigration: ScriptMigration = {
  name: '0030_retire_keyword_writers',
  supersedes: ['0019_tin_keyword_projection', '0025_scope_keyword_projections'],
  up(sql) {
    return retryOnLockTimeout(() => retireKeywordWriters(sql), {
      budgetMs: 20 * 60_000,
      backoff: { baseMs: 2_000, maxMs: 30_000 },
      onRetry: ({ attempt, delayMs }) =>
        logger.warn('Keyword retirement found busy tables; retrying', {
          attempt,
          retryInMs: Math.round(delayMs),
        }),
    })
  },
}

if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required to retire keyword writers')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await retireKeywordWritersMigration.up(sql)
  } finally {
    await sql.end()
  }
}
