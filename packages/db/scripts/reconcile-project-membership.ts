import { readFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import postgres from 'postgres'

const logger = createLogger('ProjectMembershipPush')
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) throw new Error('A database URL is required for Project schema push reconciliation')
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, max_lifetime: null })
try {
  const [state] = await sql<
    { workspace: boolean; project: boolean; connector: boolean; required: boolean }[]
  >`
    SELECT to_regclass('public.workspace') IS NOT NULL AS workspace,
      to_regclass('public.project') IS NOT NULL AS project,
      to_regclass('public.project_workspace') IS NOT NULL AS connector,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.workspace')
        AND attname = 'project_id' AND NOT attisdropped AND attnotnull) AS required
  `
  if (state.workspace && state.required && !state.connector) {
    throw new Error(
      'Project membership is already contracted; schema push from the compatibility release is unsupported. Use the current release for schema changes'
    )
  }
  if (!process.argv.includes('--prepare') && state.workspace && state.project && state.connector) {
    // Reuse additive DDL so schema push preserves the same legacy membership state as upgrades.
    const source = await readFile(
      new URL('../migrations/0405_workspace_project_column.sql', import.meta.url),
      'utf8'
    )
    const connection = await sql.reserve()
    try {
      for (const statement of source.split('--> statement-breakpoint')) {
        if (statement.includes('DROP INDEX CONCURRENTLY IF EXISTS "workspace_project_id_id_idx"')) {
          // Migration retries rebuild interrupted indexes; routine push keeps healthy indexes intact.
          const [index] = await connection<{ healthy: boolean }[]>`
            SELECT indisvalid AND indisready AS healthy FROM pg_index
            WHERE indexrelid = to_regclass('public.workspace_project_id_id_idx')
          `
          if (index?.healthy) continue
        }
        if (statement.trim()) await connection.unsafe(statement)
      }
    } finally {
      connection.release()
    }
    logger.info('Nullable Project membership column prepared')
  }
} catch (error) {
  logger.error('Project schema push stopped; resolve the error and retry', {
    code: getPostgresErrorCode(error),
    reason: getErrorMessage(error),
  })
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 1 })
}
