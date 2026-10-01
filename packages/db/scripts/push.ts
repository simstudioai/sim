import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('DatabasePush')
const RECONCILIATION_COMMANDS = [
  ['bun', '--env-file=.env', 'run', './scripts/reconcile-credential-group-resource-policies.ts'],
  ['bun', '--env-file=.env', 'run', './scripts/reconcile-oauth-provider.ts'],
  ['bun', '--env-file=.env', 'run', './script-migrations/0016_backfill_search_vectors.ts'],
  ['bun', '--env-file=.env', 'run', './script-migrations/0019_tin_keyword_projection.ts'],
  ['bun', '--env-file=.env', 'run', './script-migrations/0021_embedding_search_connector.ts'],
  ['bun', '--env-file=.env', 'run', './script-migrations/0024_knowledge_projection_async.ts'],
  ['bun', '--env-file=.env', 'run', './script-migrations/0025_scope_keyword_projections.ts'],
  ['bun', '--env-file=.env', 'run', './script-migrations/0026_user_table_schema_for_write.ts'],
]

/** Historical push reconcilers recreate retired projections and cannot run after replacement starts. */
async function retirementAllowsPush(): Promise<boolean> {
  const url = process.env.DATABASE_URL
  if (!url) {
    logger.error('DATABASE_URL is required for schema push')
    return false
  }
  let sql: Sql | undefined
  try {
    sql = postgres(url, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      connection: { statement_timeout: 2_000, lock_timeout: 100 },
      onnotice: () => undefined,
    })
    const [state] = await sql<{ present: boolean }[]>`
      SELECT to_regclass('public.search_retirement_state') IS NOT NULL AS present`
    if (state.present) {
      logger.error(
        'Schema push is disabled after Search retirement starts, including completed retirement. Use reviewed versioned migrations; push reconcilers would restore retired projections'
      )
      return false
    }
    return true
  } catch (error) {
    logger.error('Unable to verify schema-push safety', { code: getPostgresErrorCode(error) })
    return false
  } finally {
    await sql?.end({ timeout: 1 }).catch(() => undefined)
  }
}

/**
 * Push treats additions and removals as distinct objects by default. The pinned
 * Drizzle patch reads this policy only in the push subprocess; generation keeps
 * its ordinary rename prompts. --interactive-renames opts back into that chooser.
 * --force remains the independent approval for data-loss statements.
 */
export async function runPush(args: string[]): Promise<number> {
  const interactiveRenames = args.includes('--interactive-renames')
  const help = args.includes('--help') || args.includes('-h')
  if (help) {
    logger.info('Use --interactive-renames in a terminal to choose intentional renames.')
  }
  if (interactiveRenames && !help && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    logger.error(
      '--interactive-renames requires a terminal; use the default create/drop policy in CI.'
    )
    return 1
  }

  if (!help && !(await retirementAllowsPush())) return 1

  if (!help && args.includes('--force')) {
    const preparation = Bun.spawn(['bun', '--env-file=.env', 'run', './scripts/prepare-push.ts'], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const preparationExit = await preparation.exited
    if (preparationExit !== 0) return preparationExit
  }

  const pushArgs = args.filter((arg) => arg !== '--interactive-renames')
  const child = Bun.spawn(
    ['bunx', '--no-install', 'drizzle-kit', 'push', '--config=./drizzle.config.ts', ...pushArgs],
    {
      env: { ...process.env, SIM_DB_PUSH_RENAME_MODE: interactiveRenames ? 'prompt' : 'create' },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }
  )
  const exitCode = await child.exited
  if (exitCode !== 0 || help) return exitCode

  for (const command of RECONCILIATION_COMMANDS) {
    const reconciliation = Bun.spawn(command, {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const reconciliationExit = await reconciliation.exited
    if (reconciliationExit !== 0) return reconciliationExit
  }
  return 0
}

if (import.meta.main) {
  process.exit(await runPush(process.argv.slice(2)))
}
