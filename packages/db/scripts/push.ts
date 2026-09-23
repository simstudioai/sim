/**
 * Push flags go to Drizzle, then the reconciliation steps repair what a schema push cannot express:
 * each script migration listed here builds objects outside `schema.ts` (backfilled projections,
 * extension-backed indexes) that a push would otherwise drop or leave empty.
 */
export function pushCommands(flags: readonly string[]): string[][] {
  return [
    ['bunx', 'drizzle-kit', 'push', '--config=./drizzle.config.ts', ...flags],
    ['bun', '--env-file=.env', 'run', './scripts/reconcile-credential-group-resource-policies.ts'],
    ['bun', '--env-file=.env', 'run', './scripts/reconcile-oauth-provider.ts'],
    ['bun', '--env-file=.env', 'run', './script-migrations/0016_backfill_search_vectors.ts'],
    ['bun', '--env-file=.env', 'run', './script-migrations/0019_tin_keyword_projection.ts'],
    ['bun', '--env-file=.env', 'run', './script-migrations/0021_embedding_search_connector.ts'],
    ['bun', '--env-file=.env', 'run', './script-migrations/0024_knowledge_projection_async.ts'],
  ]
}

if (import.meta.main) {
  for (const command of pushCommands(process.argv.slice(2))) {
    const child = Bun.spawn(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    const exitCode = await child.exited
    if (exitCode !== 0) process.exit(exitCode)
  }
}
