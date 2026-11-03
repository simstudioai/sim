import { readFile } from 'node:fs/promises'
import { enforceProjectMembership } from '@sim/db/maintenance/project-enforcement'
import journal from '@sim/db/migrations/meta/_journal.json'
import { runScriptMigrations } from '@sim/db/script-migrations'
import { projectMembershipMigration } from '@sim/db/script-migrations/0032_project_membership'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import postgres from 'postgres'

const logger = createLogger('ProjectMembershipPush')
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) throw new Error('A database URL is required for Project schema push reconciliation')
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, max_lifetime: null })

interface ProjectSchemaState {
  workspace: boolean
  project: boolean
  connector: boolean
  rollout: boolean
  journal: boolean
  /** Null when `workspace.project_id` does not exist; otherwise whether it is NOT NULL. */
  projectIdNotNull: boolean | null
}

async function readProjectSchemaState(): Promise<ProjectSchemaState> {
  const [state] = await sql<ProjectSchemaState[]>`
    SELECT to_regclass('public.workspace') IS NOT NULL AS workspace,
      to_regclass('public.project') IS NOT NULL AS project,
      to_regclass('public.project_workspace') IS NOT NULL AS connector,
      to_regclass('public.project_membership_rollout') IS NOT NULL AS rollout,
      to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal,
      (SELECT attnotnull FROM pg_attribute WHERE attrelid = to_regclass('public.workspace')
        AND attname = 'project_id' AND NOT attisdropped) AS "projectIdNotNull"
  `
  return state
}

/**
 * Classifies a development push database that has no connector writer to drain: either it
 * predates Projects entirely, or an earlier bootstrap committed the expansion and stopped before
 * enforcement. Only the versioned 0406 creates the rollout marker, so a marker that the migration
 * journal does not account for, beside a connector nothing has written, is a bootstrap to resume.
 * Every other shape returns null and keeps the writer-drain refusal.
 */
async function classifyProjectBootstrap(
  state: ProjectSchemaState
): Promise<'fresh' | 'resume' | null> {
  if (!state.workspace || state.projectIdNotNull) return null
  const parts = [state.project, state.connector, state.rollout, state.projectIdNotNull !== null]
  if (parts.every((present) => !present)) return 'fresh'
  if (!parts.every(Boolean)) return null
  const [connector] = await sql<{ populated: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM public.project_workspace) AS populated`
  if (connector.populated) return null
  if (state.journal) {
    const expansion = journal.entries.find((entry) => entry.tag === '0406_workspace_project_column')
    if (!expansion)
      throw new Error('Project column expansion is missing from the migration journal')
    const [applied] = await sql<{ versioned: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations
        WHERE created_at = ${expansion.when}) AS versioned`
    if (applied.versioned) return null
  }
  return 'resume'
}

async function migrationStatements(tag: string): Promise<string[]> {
  const source = await readFile(new URL(`../migrations/${tag}.sql`, import.meta.url), 'utf8')
  return source.split('--> statement-breakpoint').filter((statement) => statement.trim())
}

/**
 * Applies the versioned Project expansion, then the registered script migration on this
 * single-session connection, recording it as the migration runner does. 0406 opens by committing
 * the migrator's batch; leaving that out commits the 0394 foundation together with the rollout
 * marker, so an interrupted bootstrap leaves either no Project schema or one it can resume.
 */
async function bootstrapProjects(mode: 'fresh' | 'resume'): Promise<void> {
  logger.info('Bootstrapping Projects for a development push database without them', { mode })
  const foundation = mode === 'fresh' ? await migrationStatements('0394_project_foundation') : []
  const [batchCommit, ...expansion] = await migrationStatements('0406_workspace_project_column')
  if (batchCommit.trim() !== 'COMMIT;') {
    throw new Error('Project column expansion no longer opens with the migrator batch commit')
  }
  await sql.unsafe('BEGIN')
  try {
    for (const statement of [...foundation, ...expansion]) await sql.unsafe(statement)
  } catch (error) {
    await sql.unsafe('ROLLBACK').catch(() => undefined)
    throw error
  }
  await runScriptMigrations(sql, [projectMembershipMigration])
}

const prepare = process.argv.includes('--prepare')
try {
  let state = await readProjectSchemaState()
  if (prepare && process.env.SIM_DEV_DB_PUSH === '1') {
    const bootstrap = await classifyProjectBootstrap(state)
    if (bootstrap) {
      await bootstrapProjects(bootstrap)
      state = await readProjectSchemaState()
    }
  }
  if (state.workspace && (state.connector || !state.projectIdNotNull || !state.project)) {
    throw new Error(
      'Existing Project databases must complete the Project script migration 0032_project_membership before schema push. Use the phased migration path for retained data; schema push cannot bypass the writer-drain requirement'
    )
  }
  if (!prepare && state.workspace && state.project) {
    /** Drizzle cannot express deferred FK timing; fresh push shares the migration finalizer. */
    await enforceProjectMembership(sql)
    logger.info('Project membership validation and native constraints completed')
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
