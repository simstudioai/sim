import journal from '@sim/db/migrations/meta/_journal.json'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'

const logger = createLogger('ProjectContractPreflight')
const migration = journal.entries.find(
  (entry) => entry.tag === '0395_project_membership_enforcement'
)
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!migration || !url)
  throw new Error('Project contract preflight requires migration metadata and a database URL')
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
  if (required && tables.journal) {
    const [applied] = await sql<{ complete: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= ${migration.when}) AS complete
    `
    required = !applied?.complete
  }
  process.stdout.write(`required=${required}\n`)
} catch {
  logger.error('Cannot establish Project contract prerequisites; refusing migration')
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
