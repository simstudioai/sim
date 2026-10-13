import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('DropKeywordTin')

/**
 * Drops Tin's table once 0030 has removed the triggers that wrote it. A SQL migration cannot do
 * this: SQL runs before scripts, so an upgrade skipping 0030's release would drop the table under
 * live writer triggers. The FK to `embedding` locks it, so a busy writer fails fast and retries.
 */
export async function dropKeywordTin(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '100ms'")
    await tx.unsafe("SET LOCAL statement_timeout = '5s'")
    await tx.unsafe('DROP TABLE IF EXISTS embedding_keyword_tin RESTRICT')
  })
}

export const dropKeywordTinMigration: ScriptMigration = {
  name: '0031_drop_keyword_tin',
  up(sql) {
    return retryOnLockTimeout(() => dropKeywordTin(sql), {
      budgetMs: 20 * 60_000,
      backoff: { baseMs: 2_000, maxMs: 30_000 },
      onRetry: ({ attempt, delayMs }) =>
        logger.warn('Keyword Tin drop found busy tables; retrying', {
          attempt,
          retryInMs: Math.round(delayMs),
        }),
    })
  },
}

if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required to drop keyword Tin')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await dropKeywordTinMigration.up(sql)
  } finally {
    await sql.end()
  }
}
