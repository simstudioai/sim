import { readFile } from 'node:fs/promises'
import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('DevSchemaPreparation')
const REQUIRE_SSO_MIGRATION = new URL(
  '../migrations/0350_organization_require_sso.sql',
  import.meta.url
)

/**
 * Apply the existing additive migration before push compares require_sso with
 * departed_member_usage. Otherwise Drizzle asks whether the latter was renamed.
 * Fresh databases still get the entire organization table from push.
 */
export async function prepareDevSchema(sql: Sql): Promise<boolean> {
  const migration = await readFile(REQUIRE_SSO_MIGRATION, 'utf8')
  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '5s'`
    await tx`SET LOCAL statement_timeout = '30s'`
    await tx`SET LOCAL search_path = public`
    const [table] = await tx<{ exists: boolean }[]>`
      SELECT to_regclass('public.organization') IS NOT NULL AS exists
    `
    if (!table.exists) return false

    await tx`LOCK TABLE public.organization IN ACCESS EXCLUSIVE MODE`
    const [column] = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.organization'::regclass
          AND attname = 'require_sso' AND NOT attisdropped
      ) AS exists
    `
    if (column.exists) return false

    await tx.unsafe(migration)
    return true
  })
}

if (import.meta.main) {
  if (process.env.SIM_DEV_DB_PUSH !== '1') {
    throw new Error('Dev schema preparation requires SIM_DEV_DB_PUSH=1')
  }
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('Missing database URL for dev schema preparation')

  const sql = postgres(url, { max: 1, connect_timeout: 10 })
  try {
    logger.info('Dev schema preparation completed', { applied: await prepareDevSchema(sql) })
  } catch (error) {
    logger.error('Dev schema preparation failed', { code: getPostgresErrorCode(error) })
    process.exitCode = 1
  } finally {
    await sql.end()
  }
}
