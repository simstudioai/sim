import { enforceProjectMembership } from '@sim/db/maintenance/project-enforcement'
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
  if (state.workspace && (state.connector || !state.required || !state.project)) {
    throw new Error(
      'Existing Project databases must complete the Project script migration 0031 before schema push. Use the phased migration path for retained data; schema push cannot bypass the writer-drain requirement'
    )
  }
  if (!process.argv.includes('--prepare') && state.workspace && state.project) {
    // Drizzle cannot express lifecycle triggers; fresh push uses the same enforcement as migrations.
    await enforceProjectMembership(sql)
    logger.info('Project membership validation and lifecycle enforcement completed')
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
