import { fileURLToPath } from 'node:url'
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

/** Keep preparation, Drizzle and reconcilers fenced without a session lock or a retained snapshot. */
async function withRetirementFence(run: (signal: AbortSignal) => Promise<number>): Promise<number> {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) {
    logger.error('DATABASE_URL is required for schema push')
    return 1
  }
  const abort = new AbortController()
  let sql: Sql | undefined
  try {
    const url = new URL(rawUrl)
    for (const parameter of ['application_name', 'statement_timeout', 'lock_timeout', 'options']) {
      url.searchParams.delete(parameter)
    }
    sql = postgres(url.toString(), {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      max_lifetime: null,
      connection: { application_name: 'sim-db-push', statement_timeout: 2_000, lock_timeout: 100 },
      onnotice: () => undefined,
      onclose: () => abort.abort(),
    })
    return (await sql.begin('isolation level read committed read only', async (tx) => {
      // Simple protocol closes SELECT portals so concurrent index builds do not wait on their snapshots.
      const [locks] = await tx<{ maintenance: boolean; migration: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended('sim:search-retirement-maintenance', 0)) AS maintenance,
          pg_try_advisory_xact_lock(4961002270::bigint) AS migration`.simple()
      if (!locks.maintenance || !locks.migration) {
        logger.error('Another migration or retirement operation is active; retry schema push later')
        return 1
      }
      const [state] = await tx<{ present: boolean }[]>`
        SELECT to_regclass('public.search_retirement_state') IS NOT NULL AS present`.simple()
      if (state.present) {
        logger.error(
          'Schema push is disabled after Search retirement starts, including completed retirement. Use reviewed versioned migrations; push reconcilers would restore retired projections'
        )
        return 1
      }
      return run(abort.signal)
    })) as number
  } catch (error) {
    logger.error(
      abort.signal.aborted
        ? 'Schema-push lock connection closed; stopped all commands'
        : 'Schema push stopped',
      { code: getPostgresErrorCode(error) }
    )
    return 1
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

  async function runCommands(signal?: AbortSignal): Promise<number> {
    async function runCommand(command: string[]): Promise<number> {
      signal?.throwIfAborted()
      const child = Bun.spawn(command, {
        env: { ...process.env, SIM_DB_PUSH_RENAME_MODE: interactiveRenames ? 'prompt' : 'create' },
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        signal,
        killSignal: 'SIGKILL',
      })
      const code = await child.exited
      signal?.throwIfAborted()
      return code
    }

    if (!help && args.includes('--force')) {
      const code = await runCommand(['bun', '--env-file=.env', 'run', './scripts/prepare-push.ts'])
      if (code !== 0) return code
    }
    const pushArgs = args.filter((arg) => arg !== '--interactive-renames')
    // Launch the installed CLI directly so losing the fence also terminates its database connection.
    const cli = fileURLToPath(new URL('bin.cjs', import.meta.resolve('drizzle-kit')))
    const exitCode = await runCommand([
      'bun',
      cli,
      'push',
      '--config=./drizzle.config.ts',
      ...pushArgs,
    ])
    if (exitCode !== 0 || help) return exitCode

    for (const command of RECONCILIATION_COMMANDS) {
      const code = await runCommand(command)
      if (code !== 0) return code
    }
    return 0
  }
  return help ? runCommands() : withRetirementFence(runCommands)
}

if (import.meta.main) {
  process.exit(await runPush(process.argv.slice(2)))
}
