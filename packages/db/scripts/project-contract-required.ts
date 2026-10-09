import journal from '@sim/db/migrations/meta/_journal.json'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import postgres from 'postgres'

const logger = createLogger('ProjectContractPreflight')
const expansion = journal.entries.find((entry) => entry.tag === '0404_workspace_project_column')
const migration = journal.entries.find(
  (entry) => entry.tag === '0405_project_membership_enforcement'
)
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!expansion || !migration || !url)
  throw new Error(
    'Project column contract preflight requires migration metadata and a database URL'
  )
const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  connection: { statement_timeout: 10_000 },
})
try {
  const [tables] = await sql<{ workspace: string | null; journal: string | null }[]>`
    SELECT to_regclass('public.workspace')::text AS workspace,
      to_regclass('drizzle.__drizzle_migrations')::text AS journal
  `
  if (!tables) throw new Error('Could not inspect migration prerequisites')
  let required = Boolean(tables.workspace)
  if (required) {
    if (!tables.journal) {
      throw new Error('Deploy the workspace Project column expansion before enforcing membership')
    }
    const [applied] = await sql<{ expanded: boolean; complete: boolean; columnExists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${expansion.when}) AS expanded,
        EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= ${migration.when}) AS complete,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'workspace' AND column_name = 'project_id'
        ) AS "columnExists"
    `
    if (!applied?.expanded || !applied.columnExists) {
      throw new Error('Deploy the workspace Project column expansion before enforcing membership')
    }
    required = !applied.complete
  }
  process.stdout.write(`required=${required}\n`)
} catch (error) {
  logger.error('Cannot establish Project column contract prerequisites; refusing migration', {
    reason: getErrorMessage(error),
  })
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
