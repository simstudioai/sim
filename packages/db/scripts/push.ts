/** Forward push flags to Drizzle before running the schema reconciliation steps. */
const commands = [
  ['bunx', 'drizzle-kit', 'push', '--config=./drizzle.config.ts', ...process.argv.slice(2)],
  ['bun', '--env-file=.env', 'run', './scripts/reconcile-credential-group-resource-policies.ts'],
  ['bun', '--env-file=.env', 'run', './scripts/reconcile-oauth-provider.ts'],
  ['bun', '--env-file=.env', 'run', './script-migrations/0016_backfill_search_vectors.ts'],
]

for (const command of commands) {
  const child = Bun.spawn(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
}
