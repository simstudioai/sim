import { readProjectMembershipPhase } from '@sim/db/maintenance/project-rollout'
import journal from '@sim/db/migrations/meta/_journal.json'
import { projectMembershipMigration } from '@sim/db/script-migrations/0031_project_membership'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import postgres from 'postgres'

const logger = createLogger('ProjectContractPreflight')
const expansion = journal.entries.find((entry) => entry.tag === '0406_workspace_project_column')
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!expansion || !url)
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
    const [applied] = await sql<{ expanded: boolean; columnExists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${expansion.when}) AS expanded,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'workspace' AND column_name = 'project_id'
        ) AS "columnExists"
    `
    if (!applied?.expanded || !applied.columnExists) {
      throw new Error('Deploy the workspace Project column expansion before enforcing membership')
    }
    const phase = await readProjectMembershipPhase(sql)
    if (phase === 'connector') {
      const [state] = await sql`SELECT
        to_regclass('public.project_workspace') IS NOT NULL AS connector,
        EXISTS (SELECT 1 FROM public.workspace WHERE project_id IS NOT NULL) AS populated`
      if (!state?.connector || state.populated)
        throw new Error('Connector authority has inconsistent membership; reconcile before rollout')
    }
    const [scripts] =
      await sql`SELECT to_regclass('public.script_migrations') IS NOT NULL AS present`
    if (scripts.present) {
      const [completed] = await sql`SELECT EXISTS (
        SELECT 1 FROM script_migrations WHERE name = ${projectMembershipMigration.name}) AS applied`
      required = !completed.applied
    }
    if (!required) {
      const [state] = await sql`SELECT
        to_regclass('public.project_workspace') IS NULL AS retired,
        EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'workspace'::regclass
          AND attname = 'project_id' AND attnotnull AND NOT attisdropped) AS enforced`
      if (phase !== 'column' || !state.retired || !state.enforced)
        throw new Error('Project migration receipt disagrees with the physical schema')
    }
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
